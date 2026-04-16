// adapters/outbound/tenant-registry-resolver/default-runtime-registry-v1.js


'use strict';

const fs = require(`node:fs/promises`);
const path = require(`node:path`);
const TenantRegistryResolverPort = require(`@/_core/_ports/inbound/tenant-registry-resolver-port`);

TenantRegistryResolverPort.persistRegistryAdapter = async function persistRegistryAdapter({
  storage,
  registry,
  tenantsPath,
  registryPath
}) {
  const registryRootParent = path.dirname(registryPath);
  const tempRegistryPath = `${registryPath}.__tmp__-${process.pid}-${Date.now()}`;
  const previousRegistryPath = `${registryPath}.__prev__-${process.pid}-${Date.now()}`;

  await fs.access(registryRootParent);
  await fs.rm(tempRegistryPath, { recursive: true, force: true });
  await fs.rm(previousRegistryPath, { recursive: true, force: true });
  await fs.mkdir(tempRegistryPath);
  await preserveNonTenantEntries({
    sourceRoot: registryPath,
    targetRoot: tempRegistryPath
  });

  const domains = [...(registry?.domains?.values?.() ?? [])];
  const hosts = [...(registry?.hosts?.values?.() ?? [])];
  const appsByTenantId = groupAppsByTenantId(hosts);

  for (const tenantRecord of domains) {
    const tenantFolderName = `tenant_${tenantRecord.tenantId}`;
    const tenantFolder = path.join(tempRegistryPath, tenantFolderName);
    const tenantApps = appsByTenantId.get(tenantRecord.tenantId) ?? [];

    await storage.createFolder(tenantFolder);
    await storage.writeFile(
      path.join(tenantFolder, `config.json`),
      JSON.stringify(buildTenantSnapshot({
        tenantRecord,
        tenantsPath,
        tenantApps
      }), null, 2),
      `utf8`
    );

    for (const appRecord of tenantApps) {
      const appFolderName = `app_${appRecord.appId}`;
      const appFolder = path.join(tenantFolder, appFolderName);
      await storage.createFolder(appFolder);
      await storage.writeFile(
        path.join(appFolder, `config.json`),
        JSON.stringify(buildAppSnapshot({
          tenantRecord,
          appRecord,
          tenantsPath
        }), null, 2),
        `utf8`
      );
    }
  }

  let previousRegistryExists = false;
  try {
    await fs.rename(registryPath, previousRegistryPath);
    previousRegistryExists = true;
  } catch (error) {
    if (error?.code !== `ENOENT`) throw error;
  }

  try {
    await fs.rename(tempRegistryPath, registryPath);
  } catch (error) {
    if (previousRegistryExists) {
      await fs.rename(previousRegistryPath, registryPath).catch(() => { });
    }
    throw error;
  }

  if (previousRegistryExists) {
    await fs.rm(previousRegistryPath, { recursive: true, force: true });
  }

  return {
    registryPath,
    tenantCount: domains.length,
    appCount: hosts.length
  };
};

module.exports = TenantRegistryResolverPort;
Object.freeze(module.exports);

function groupAppsByTenantId(appRecords) {
  const groups = new Map();
  for (const appRecord of appRecords) {
    const tenantId = String(appRecord?.tenantId ?? ``).trim();
    if (!tenantId) continue;
    const records = groups.get(tenantId) ?? [];
    records.push(appRecord);
    groups.set(tenantId, records);
  }
  return groups;
}

function buildTenantSnapshot({
  tenantRecord,
  tenantsPath,
  tenantApps
}) {
  return {
    tenantId: tenantRecord.tenantId,
    tenantDomain: tenantRecord.domain,
    certbotEmail: tenantRecord.certbotEmail ?? null,
    appRouting: tenantRecord.appRouting ?? null,
    appNames: tenantRecord.appNames ?? tenantApps.map((appRecord) => appRecord.appName),
    aliases: tenantRecord.aliases ?? [],
    internalProxy: tenantRecord.internalProxy ?? null,
    certificateAutomation: tenantRecord.certificateAutomation ?? {
      letsEncryptTriggeredDomains: {}
    },
    source: {
      tenantsRoot: tenantsPath,
      tenantFolder: tenantRecord.rootFolder ?? null
    }
  };
}

function buildAppSnapshot({
  tenantRecord,
  appRecord,
  tenantsPath
}) {
  const {
    rootFolder,
    actionsRootFolder,
    httpActionsRootFolder,
    wsActionsRootFolder,
    assetsRootFolder,
    httpMiddlewaresRootFolder,
    wsMiddlewaresRootFolder,
    routesRootFolder,
    httpRoutesRootFolder,
    wsRoutesRootFolder,
    appConfigMtimeMs,
    tenantEntrypointMtimeMs,
    ...persistedConfig
  } = appRecord ?? {};

  return {
    ...persistedConfig,
    tenantDomain: tenantRecord.domain,
    source: {
      tenantsRoot: tenantsPath,
      appFolder: rootFolder ?? null,
      actionsRootFolder: actionsRootFolder ?? null,
      httpActionsRootFolder: httpActionsRootFolder ?? null,
      wsActionsRootFolder: wsActionsRootFolder ?? null,
      assetsRootFolder: assetsRootFolder ?? null,
      httpMiddlewaresRootFolder: httpMiddlewaresRootFolder ?? null,
      wsMiddlewaresRootFolder: wsMiddlewaresRootFolder ?? null,
      routesRootFolder: routesRootFolder ?? null,
      httpRoutesRootFolder: httpRoutesRootFolder ?? null,
      wsRoutesRootFolder: wsRoutesRootFolder ?? null,
      appConfigMtimeMs: appConfigMtimeMs ?? null,
      tenantEntrypointMtimeMs: tenantEntrypointMtimeMs ?? null
    }
  };
}

async function preserveNonTenantEntries({
  sourceRoot,
  targetRoot
}) {
  let entries = [];
  try {
    entries = await fs.readdir(sourceRoot, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === `ENOENT`) return;
    throw error;
  }

  for (const entry of entries) {
    if (isTenantRegistryEntry(entry.name)) continue;
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    await fs.cp(sourcePath, targetPath, {
      force: true,
      recursive: true,
      errorOnExist: false
    });
  }
}

function isTenantRegistryEntry(entryName) {
  return /^tenant_[a-z0-9]+$/i.test(String(entryName ?? ``).trim());
}
