'use strict';

/*
 * Nginx web-server adapter
 *
 * This adapter materializes one managed nginx config per exposed domain via
 * `updateSource(source, routeType, webServerConfig)`.
 *
 * Supported domain route types:
 * - `tenant`:
 *   Generates a normal tenant-facing vhost. The proxied request follows the
 *   standard tenant routing flow in the transport process.
 * - `app`:
 *   Generates a direct app-alias vhost. In this case the nginx config injects
 *   the internal routing header `X-Ehecoatl-Target-App-Id`, allowing ingress
 *   to bypass app-selection mode and tunnel the request directly to the target
 *   app inside the current tenant.
 *
 * TLS lookup behavior:
 * - Primary source:
 *   `certificateService.getCertificatePath(domain, tenantId)`
 *   which currently resolves tenant-scope SSL first and Let's Encrypt second
 * - Fallback source:
 *   Ehecoatl generic placeholder certificate under internal-scope runtime SSL.
 *
 * So, yes:
 * - the service can materialize separate nginx configs for normal tenant domains
 *   and direct app domains;
 * - direct app domains are distinguished by the special internal header above;
 * - TLS lookup prefers the certificate-service result before the internal
 *   fallback certificate.
 */

const fs = require(`node:fs/promises`);
const path = require(`node:path`);
const { execFile } = require(`node:child_process`);
const { promisify } = require(`node:util`);

const WebServerServicePort = require(`@/_core/_ports/outbound/web-server-service-port`);
const { renderLayerPath } = require(`@/contracts/utils`);
const { renderTenantTemplate } = require(`./source-renderer`);

const execFileAsync = promisify(execFile);
const adapterState = {
  config: null,
  dirty: false
};

WebServerServicePort.setupServerAdapter = async function setupServerAdapter(webServerConfig = {}) {
  const config = normalizeWebServerConfig(webServerConfig);
  adapterState.config = config;
  await ensureManagedConfigDir(config.managedConfigDir, webServerConfig);
  return {
    managedConfigDir: config.managedConfigDir
  };
};

WebServerServicePort.updateSourceAdapter = async function updateSourceAdapter(source, routeType = null, webServerConfig = {}) {
  const config = normalizeWebServerConfig(webServerConfig);
  adapterState.config = config;
  await ensureManagedConfigDir(config.managedConfigDir, webServerConfig);

  const sourceKey = String(source?.key ?? source?.domain ?? source?.tenantId ?? ``).trim();
  if (!sourceKey) {
    throw new Error(`web-server-service nginx adapter requires source.key, source.domain or source.tenantId`);
  }

  const normalizedRouteType = normalizeRouteType(routeType ?? source?.routeType ?? null);
  const forceReload = source?.forceReload === true;
  const tenantTemplatePath = await ensureTenantTemplatePath(source, config);
  const templateContent = await fs.readFile(tenantTemplatePath, `utf8`);
  const renderedConfig = renderTenantTemplate(templateContent, await withEffectiveTls({
    ...source,
    routeType: normalizedRouteType
  }, config));
  const targetPath = buildManagedSourcePath(sourceKey, config);
  const previousContent = await fs.readFile(targetPath, `utf8`).catch(() => null);

  if (previousContent === renderedConfig) {
    if (forceReload) {
      adapterState.dirty = true;
    }
    return {
      changed: false,
      reloadRequired: forceReload,
      sourceKey,
      targetPath,
      templatePath: tenantTemplatePath
    };
  }

  await writeManagedSource(targetPath, renderedConfig, webServerConfig);
  adapterState.dirty = true;

  return {
    changed: true,
    sourceKey,
    targetPath,
    templatePath: tenantTemplatePath
  };
};

WebServerServicePort.removeSourceAdapter = async function removeSourceAdapter(sourceKey, webServerConfig = {}) {
  const config = normalizeWebServerConfig(webServerConfig);
  adapterState.config = config;

  const normalizedSourceKey = String(sourceKey ?? ``).trim();
  if (!normalizedSourceKey) {
    throw new Error(`web-server-service nginx adapter requires a sourceKey`);
  }

  const targetPath = buildManagedSourcePath(normalizedSourceKey, config);
  const existed = await fs.access(targetPath).then(() => true).catch(() => false);
  if (!existed) {
    return {
      changed: false,
      sourceKey: normalizedSourceKey,
      targetPath
    };
  }

  try {
    await removeManagedSource(targetPath, webServerConfig);
    adapterState.dirty = true;
    return {
      changed: true,
      sourceKey: normalizedSourceKey,
      targetPath
    };
  } catch (error) {
    if (error?.code === `ENOENT`) {
      return {
        changed: false,
        sourceKey: normalizedSourceKey,
        targetPath
      };
    }
    throw error;
  }
};

WebServerServicePort.flushChangesAdapter = async function flushChangesAdapter(webServerConfig = {}) {
  const config = normalizeWebServerConfig(webServerConfig);
  adapterState.config = config;

  if (!adapterState.dirty) {
    return {
      changed: false,
      tested: false,
      reloaded: false
    };
  }

  if (typeof webServerConfig?.privilegedHostOperation === `function`) {
    await webServerConfig.privilegedHostOperation(`nginx.reload`, {
      testCommand: config.nginxTestCommand,
      reloadCommand: [`systemctl`, `reload`, `nginx`]
    });
  } else {
    await runCommand(config.nginxTestCommand);
    await runCommand(config.nginxReloadCommand);
  }
  adapterState.dirty = false;

  return {
    changed: true,
    tested: true,
    reloaded: true
  };
};

module.exports = WebServerServicePort;
Object.freeze(WebServerServicePort);

function normalizeWebServerConfig(webServerConfig = {}) {
  return Object.freeze({
    managedConfigDir: webServerConfig.managedConfigDir ?? `/etc/nginx/conf.d/ehecoatl`,
    managedConfigPrefix: webServerConfig.managedConfigPrefix ?? `tenant_`,
    managedConfigOwner: webServerConfig.managedConfigOwner ?? `ehecoatl`,
    managedConfigGroup: webServerConfig.managedConfigGroup ?? `g_directorScope`,
    managedConfigMode: String(webServerConfig.managedConfigMode ?? `2770`),
    nginxTestCommand: normalizeCommand(webServerConfig.nginxTestCommand ?? [`nginx`, `-t`], `nginxTestCommand`),
    nginxReloadCommand: normalizeCommand(webServerConfig.nginxReloadCommand ?? [`nginx`, `-s`, `reload`], `nginxReloadCommand`),
    defaultTenantKitName: webServerConfig.defaultTenantKitName ?? `empty-tenant`,
    defaultTenantKitBaseDir: webServerConfig.defaultTenantKitBaseDir ?? `/srv/opt/ehecoatl/tenant-kits`,
    getCertificatePath: typeof webServerConfig.getCertificatePath === `function`
      ? webServerConfig.getCertificatePath
      : null
  });
}

function normalizeCommand(command, key) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(`web-server-service nginx adapter requires ${key} to be a non-empty command array`);
  }
  return command.map((entry) => String(entry));
}

async function runCommand(command) {
  const [binary, ...args] = command;
  await execFileAsync(binary, args);
}

async function ensureManagedConfigDir(targetDir, webServerConfig = {}) {
  if (typeof webServerConfig?.privilegedHostOperation === `function`) {
    await webServerConfig.privilegedHostOperation(`nginx.ensureManagedConfigDir`, {
      targetDir,
      owner: adapterState.config?.managedConfigOwner ?? `ehecoatl`,
      group: adapterState.config?.managedConfigGroup ?? `g_directorScope`,
      mode: adapterState.config?.managedConfigMode ?? `2770`
    });
    return;
  }
  await fs.mkdir(targetDir, { recursive: true });
}

async function writeManagedSource(targetPath, content, webServerConfig = {}) {
  await fs.writeFile(targetPath, content, `utf8`);
}

async function removeManagedSource(targetPath, webServerConfig = {}) {
  await fs.rm(targetPath, { force: true });
}

function buildManagedSourcePath(sourceKey, config) {
  return path.join(config.managedConfigDir, `${config.managedConfigPrefix}${sourceKey}.conf`);
}

async function ensureTenantTemplatePath(source, config) {
  const tenantRoot = String(source?.tenantRoot ?? ``).trim();
  if (!tenantRoot) {
    throw new Error(`web-server-service nginx adapter requires source.tenantRoot`);
  }

  const tenantTemplatePath = path.join(tenantRoot, `.ehecoatl`, `lib`, `nginx.e.conf`);
  try {
    await fs.access(tenantTemplatePath);
    return tenantTemplatePath;
  } catch (error) {
    if (error?.code !== `ENOENT`) throw error;
  }

  const fallbackTemplatePath = await resolveDefaultTenantTemplatePath(config);
  const fallbackTemplateContent = await fs.readFile(fallbackTemplatePath, `utf8`);
  await fs.mkdir(path.dirname(tenantTemplatePath), { recursive: true });
  await fs.writeFile(tenantTemplatePath, fallbackTemplateContent, `utf8`);
  return tenantTemplatePath;
}

async function resolveDefaultTenantTemplatePath(config) {
  const customTenantKitTemplate = path.join(
    config.defaultTenantKitBaseDir,
    config.defaultTenantKitName,
    `.ehecoatl`,
    `lib`,
    `nginx.e.conf`
  );

  try {
    await fs.access(customTenantKitTemplate);
    return customTenantKitTemplate;
  } catch (error) {
    if (error?.code !== `ENOENT`) throw error;
  }

  const packagedTemplatePath = path.resolve(
    __dirname,
    `../../../../tenant-kits`,
    config.defaultTenantKitName,
    `.ehecoatl`,
    `lib`,
    `nginx.e.conf`
  );
  await fs.access(packagedTemplatePath);
  return packagedTemplatePath;
}

async function withEffectiveTls(source, config = {}) {
  const domain = String(source?.domain ?? source?.tenantDomain ?? ``).trim().toLowerCase();
  const genericSslRoot = renderLayerPath(`internalScope`, `RUNTIME`, `ssl`, {});
  const genericCertPath = genericSslRoot ? path.join(genericSslRoot, `generic.fullchain.pem`) : ``;
  const genericKeyPath = genericSslRoot ? path.join(genericSslRoot, `generic.privkey.pem`) : ``;

  const resolvedTls = typeof config?.getCertificatePath === `function`
    ? await config.getCertificatePath(domain, source?.tenantId ?? null)
    : null;

  if (resolvedTls?.fullchainPath && resolvedTls?.privkeyPath) {
    return {
      ...source,
      effectiveTls: {
        mode: `tenant`,
        certPath: resolvedTls.fullchainPath,
        keyPath: resolvedTls.privkeyPath,
        httpsEnabled: true,
        httpRedirectToHttps: true
      }
    };
  }

  const genericHasTls = await filePairExists(genericCertPath, genericKeyPath);
  if (genericHasTls) {
    return {
      ...source,
      effectiveTls: {
        mode: `generic`,
        certPath: genericCertPath,
        keyPath: genericKeyPath,
        httpsEnabled: true,
        httpRedirectToHttps: false
      }
    };
  }

  return {
    ...source,
    effectiveTls: {
      mode: `none`,
      certPath: ``,
      keyPath: ``,
      httpsEnabled: false,
      httpRedirectToHttps: false
    }
  };
}

function normalizeRouteType(routeType) {
  const normalized = String(routeType ?? ``).trim().toLowerCase();
  if (normalized === `tenant` || normalized === `app`) {
    return normalized;
  }
  return `tenant`;
}

async function filePairExists(firstPath, secondPath) {
  if (!firstPath || !secondPath) return false;
  try {
    await fs.access(firstPath);
    await fs.access(secondPath);
    return true;
  } catch {
    return false;
  }
}
