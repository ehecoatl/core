// adapters/manager/tenancy-router/default-tenancy.js


'use strict';


const TenancyRouterAdapter = require(`g@/manager/tenancy-router/tenancy-router-adapter`);
const path = require(`path`);
const urlParser = require(`@/utils/tenancy/url-parser`);
const tenantRoutesCompiler = require(`@/utils/tenancy/tenant-routes-compiler`);
const tenantRoutesFindMatch = require(`@/utils/tenancy/tenant-routes-find-match`);

const tenantAliases = new Map();
const tenantHosts = new Map();

const tenantRoutesAvailableProperty = `routesAvailable`;
const hostConfigRelativePath = path.join(`src`, `config.json`);
const hostConfigErrorRelativePath = path.join(`src`, `config.validation.error.json`);
const hostEntrypointRelativePath = path.join(`src`, `app`, `index.js`);
const defaultSubdomain = `www`;
const sourceRootFolderName = `src`;
const tenantAppFolderName = `app`;
const tenantPublicFolderName = `public`;

/**
 * @param {{
 * config: typeof import('@/config/default.config')['tenancyRouter'],
 * storage: import('g@/shared/storage-service/storage-service')
 * }} param0
 */
TenancyRouterAdapter.scanTenantsAdapter = async function ({
  config,
  storage
}) {
  const tenantPath = config.tenantsPath;
  const nextAliases = new Map();
  const nextHosts = new Map();
  const invalidHosts = [];
  const previousHostSignatures = buildSignatureMap(tenantHosts);

  //TODO: check if lastupdate for updating and recompile

  // Domains
  const domainsList = await storage.listEntries(tenantPath) ?? [];
  console.log(
    `[default-tenancy.scanTenantsAdapter] tenantPath=${tenantPath} domains=${JSON.stringify(domainsList.map((entry) => ({
      name: entry?.name,
      dir: entry?.isDirectory?.(),
      file: entry?.isFile?.()
    })))}`
  );
  for (const domainEntry of domainsList) {
    const domain = domainEntry.name;
    const domainPath = path.join(tenantPath, domain);

    if (domainEntry.isFile()) { // Domain Aliases
      const aliasContent = await storage.readFile(domainPath, `utf-8`);
      const aliasConfig = JSON.parse(aliasContent);
      for (const [subdomainEntry, routeDataObject] of Object.entries(aliasConfig)) {
        if (!isAliasEnabled(routeDataObject)) continue;
        const host = `${subdomainEntry}.${domain}`.toLowerCase();
        nextAliases.set(host, sanitizeAliasRouteData(routeDataObject));
      }
      continue;
    }

    if (!domainEntry.isDirectory()) continue;

    const subdomainsList = await storage.listEntries(domainPath) ?? [];
    console.log(
      `[default-tenancy.scanTenantsAdapter] domainPath=${domainPath} hosts=${JSON.stringify(subdomainsList.map((entry) => ({
        name: entry?.name,
        dir: entry?.isDirectory?.(),
        file: entry?.isFile?.()
      })))}`
    );
    //Hosts
    for (const subdomainEntry of subdomainsList) {
      if (!subdomainEntry.isDirectory()) continue;
      const subdomain = subdomainEntry.name;
      const host = `${subdomain}.${domain}`.toLowerCase();
      const appPath = path.join(domainPath, subdomain);
      const subdomainConfigPath = path.join(appPath, hostConfigRelativePath);
      const rootFolder = path.join(config.tenantsPath, domain, subdomain);
      try {
        const hostConfigContent = await storage.readFile(subdomainConfigPath, `utf-8`);
        const hostConfig = JSON.parse(hostConfigContent);
        if (!isAppEnabled(hostConfig)) {
          await clearAppConfigValidationError(storage, appPath);
          continue;
        }
        const tenantSourceFolders = resolveTenantSourceFolders(rootFolder);
        const hostConfigMtimeMs = await resolveFileMtimeMs(storage, subdomainConfigPath);
        const tenantEntrypointMtimeMs = await resolveFileMtimeMs(
          storage,
          path.join(appPath, hostEntrypointRelativePath)
        );
        const routeDataObject = {
          host,
          domain,
          subdomain,
          rootFolder,
          ...tenantSourceFolders,
          hostConfigMtimeMs,
          tenantEntrypointMtimeMs,
          ...hostConfig
        };

        const routesAvailable = routeDataObject[tenantRoutesAvailableProperty];
        if (routesAvailable) {
          const compiledRoutes = tenantRoutesCompiler(
            routesAvailable
          );
          routeDataObject.__compiledRoutes = compiledRoutes;
        }

        await clearAppConfigValidationError(storage, appPath);
        nextHosts.set(host, routeDataObject);
      } catch (error) {
        console.log(
          `[default-tenancy.scanTenantsAdapter] hostLoadError host=${host} message=${error?.message ?? error}`
        );
        const reason = buildTenantConfigValidationError({
          host,
          rootFolder,
          hostConfigPath: subdomainConfigPath,
          error,
          scope: `host`
        });
        invalidHosts.push(reason);
        await writeAppConfigValidationError(storage, appPath, reason);
      }
    }
  }

  tenantAliases.clear();
  for (const [host, routeDataObject] of nextAliases) {
    tenantAliases.set(host, routeDataObject);
  }

  tenantHosts.clear();
  for (const [host, routeDataObject] of nextHosts) {
    tenantHosts.set(host, routeDataObject);
  }

  console.log(
    `[default-tenancy.scanTenantsAdapter] activeHosts=${JSON.stringify([...nextHosts.keys()])} aliases=${JSON.stringify([...nextAliases.keys()])} invalidHosts=${JSON.stringify(invalidHosts.map((entry) => entry.host))}`
  );

  const nextHostSignatures = buildSignatureMap(nextHosts);
  const initialScan = previousHostSignatures.size === 0;
  return {
    initialScan,
    activeHosts: [...nextHosts.values()].map((routeDataObject) => ({
      host: routeDataObject.host,
      rootFolder: routeDataObject.rootFolder
    })),
    changedHosts: initialScan
      ? []
      : [...nextHostSignatures.entries()]
        .filter(([host, signature]) => previousHostSignatures.get(host) !== signature)
        .map(([host]) => host),
    removedHosts: initialScan
      ? []
      : [...previousHostSignatures.keys()]
        .filter((host) => !nextHostSignatures.has(host)),
    invalidHosts
  };
};

function buildTenantConfigValidationError({
  host,
  rootFolder,
  hostConfigPath,
  error,
  scope
}) {
  return {
    host,
    rootFolder,
    scope,
    status: `invalid_config`,
    generatedAt: new Date().toISOString(),
    hostConfigPath,
    error: {
      name: error?.name ?? `Error`,
      code: error?.code ?? null,
      message: error?.message ?? String(error)
    }
  };
}

async function writeAppConfigValidationError(storage, hostPath, details) {
  if (!storage || typeof storage.writeFile !== `function`) return;
  const errorFilePath = path.join(hostPath, hostConfigErrorRelativePath);
  const parentFolder = path.dirname(errorFilePath);
  if (typeof storage.createFolder === `function`) {
    await storage.createFolder(parentFolder).catch(() => { });
  }
  await storage.writeFile(
    errorFilePath,
    JSON.stringify(details, null, 2),
    `utf8`
  ).catch(() => { });
}

async function clearAppConfigValidationError(storage, hostPath) {
  if (!storage || typeof storage.deleteFile !== `function`) return;
  const errorFilePath = path.join(hostPath, hostConfigErrorRelativePath);
  await storage.deleteFile(errorFilePath).catch(() => { });
}

function sanitizeAliasRouteData(routeDataObject) {
  if (!routeDataObject || typeof routeDataObject !== `object`) return routeDataObject;
  const aliasRouteData = { ...routeDataObject };
  delete aliasRouteData.aliasEnabled;
  return aliasRouteData;
}

function buildSignatureMap(hostMap) {
  return new Map(
    [...hostMap.entries()].map(([host, routeDataObject]) => [
      host,
      stableSerialize(toComparableRouteData(routeDataObject))
    ])
  );
}

function toComparableRouteData(routeDataObject) {
  if (!routeDataObject || typeof routeDataObject !== `object`) return routeDataObject;

  const comparable = {};
  for (const [key, value] of Object.entries(routeDataObject)) {
    if (key === `__compiledRoutes` || key === `hostEnabled`) continue;
    comparable[key] = value;
  }
  return comparable;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(`,`)}]`;
  }
  if (!value || typeof value !== `object`) {
    return JSON.stringify(value);
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(`,`)}}`;
}

async function resolveFileMtimeMs(storage, filePath) {
  if (typeof storage?.fileStat !== `function`) return null;

  try {
    const stats = await storage.fileStat(filePath);
    if (!stats || typeof stats.mtimeMs !== `number`) return null;
    return Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 * url: string
 * }} param0
 */
TenancyRouterAdapter.matchRouteAdapter = async function ({
  url
}) {

  if (!url) return null;
  const { host, uri } = urlParser(url);
  const routeDataObject = findRouteData(host);
  console.log(
    `[default-tenancy.matchRouteAdapter] url=${url} host=${host} uri=${uri} routeFound=${routeDataObject ? `yes` : `no`} routeHost=${routeDataObject?.host ?? `null`} compiled=${Array.isArray(routeDataObject?.__compiledRoutes) ? routeDataObject.__compiledRoutes.length : `null`}`
  );
  if (!routeDataObject) return null;
  if (routeDataObject.redirect) {
    return routeDataObject;
  }

  if (!routeDataObject.__compiledRoutes) return null;
  const routeDataMatch = tenantRoutesFindMatch(
    uri,
    routeDataObject.__compiledRoutes
  );
  if (!routeDataMatch) return null;

  return {
    host: routeDataObject.host,
    domain: routeDataObject.domain,
    subdomain: routeDataObject.subdomain,
    rootFolder: routeDataObject.rootFolder,
    appRootFolder: routeDataObject.appRootFolder,
    publicRootFolder: routeDataObject.publicRootFolder,
    diskLimit: routeDataObject.diskLimit,
    diskLimitBytes: routeDataObject.diskLimitBytes,
    methodsAvailable: routeDataObject.methodsAvailable,
    ...routeDataMatch
  };
};

function resolveTenantSourceFolders(rootFolder) {
  return {
    appRootFolder: path.join(rootFolder, sourceRootFolderName, tenantAppFolderName),
    publicRootFolder: path.join(rootFolder, sourceRootFolderName, tenantPublicFolderName)
  };
}

function findRouteData(host) {
  host = host.toLowerCase();
  return (
    findExactRouteData(host)
    ?? findDefaultHostRouteData(host)
  );
}

function findExactRouteData(host) {
  const aliasRouteData = tenantAliases.get(host);
  if (aliasRouteData) {
    if (aliasRouteData.redirect) return aliasRouteData;
    host = aliasRouteData.tenant
      ? aliasRouteData.tenant.toLowerCase()
      : host;
  }

  const routeData = tenantHosts.get(host);
  if (routeData) return routeData;
  return null;
}

function findDefaultHostRouteData(host) {
  if (host.startsWith(`${defaultSubdomain}.`)) {
    return null;
  }

  return findExactRouteData(`${defaultSubdomain}.${host}`);
}

function isAppEnabled(appConfig) {
  if (!appConfig || typeof appConfig !== `object`) return true;
  return appConfig.hostEnabled !== false;
}

function isAliasEnabled(routeDataObject) {
  if (!routeDataObject || typeof routeDataObject !== `object`) return false;
  return routeDataObject.aliasEnabled !== false;
}

module.exports = TenancyRouterAdapter;
Object.freeze(TenancyRouterAdapter);
