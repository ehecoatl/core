// test/tenant-layout-migration.test.js


'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { execFileSync } = require(`node:child_process`);

const defaultTenancyAdapter = require(`@adapter/inbound/tenant-directory-resolver/default-tenancy`);
const defaultTenantRegistryResolverAdapter = require(`@adapter/inbound/tenant-registry-resolver/default-runtime-registry-v1`);
const defaultRouteMatcherCompilerAdapter = require(`@adapter/inbound/tenant-route-matcher-compiler/default-routing-v1`);
const {
  tenantDirPrefix,
  generateUniqueOpaqueId,
  migrateLegacyTenantsSync
} = require(`@/utils/tenancy/tenant-layout`);

const tenantLayoutCliPath = path.join(__dirname, `..`, `cli`, `lib`, `tenant-layout-cli.js`);
const expectedRuntimeVersion = `9.8.7-test`;

test(`generateUniqueOpaqueId retries collisions before returning a fresh id`, () => {
  const seen = [];
  const randomChunks = [
    Buffer.alloc(12, 0),
    Buffer.alloc(12, 1)
  ];

  const id = generateUniqueOpaqueId({
    prefix: tenantDirPrefix,
    exists(folderName) {
      seen.push(folderName);
      return folderName === `${tenantDirPrefix}aaaaaaaaaaaa`;
    },
    randomBytes() {
      return randomChunks.shift();
    }
  });

  assert.equal(id, `bbbbbbbbbbbb`);
  assert.deepEqual(seen, [
    `${tenantDirPrefix}aaaaaaaaaaaa`,
    `${tenantDirPrefix}bbbbbbbbbbbb`
  ]);
});

test(`migrateLegacyTenantsSync rewrites opaque-id tenant and app folders to canonical filesystem names`, () => {
  const tenantsBase = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-layout-`));

  try {
    const legacyTenantRoot = path.join(tenantsBase, `tenant_aaaaaaaaaaaa`);
    const legacyAppRoot = path.join(legacyTenantRoot, `app_bbbbbbbbbbbb`);
    const legacyAdminRoot = path.join(legacyTenantRoot, `app_cccccccccccc`);
    fs.mkdirSync(path.join(legacyAppRoot, `config`), { recursive: true });
    fs.mkdirSync(path.join(legacyAdminRoot, `config`), { recursive: true });
    fs.writeFileSync(path.join(legacyTenantRoot, `config.json`), JSON.stringify({
      tenantId: `aaaaaaaaaaaa`,
      tenantDomain: `example.com`,
      appRoutingMode: `path`,
      defaultAppName: `admin`,
      alias: [`alias.test`]
    }));
    fs.writeFileSync(path.join(legacyAppRoot, `config`, `app.json`), JSON.stringify({
      appId: `bbbbbbbbbbbb`,
      appName: `www`,
      methodsAvailable: [`GET`]
    }));
    fs.writeFileSync(path.join(legacyAdminRoot, `config`, `app.json`), JSON.stringify({
      appId: `cccccccccccc`,
      appName: `admin`,
      methodsAvailable: [`GET`, `POST`]
    }));

    const summary = migrateLegacyTenantsSync({ tenantsBase });

    assert.equal(summary.aliasesMigrated.length, 0);
    assert.equal(summary.migrated.length, 1);
    assert.equal(path.basename(summary.migrated[0].tenantRoot), `tenant_example.com`);
    assert.equal(summary.migrated[0].tenantDomain, `example.com`);
    assert.equal(summary.migrated[0].apps.length, 2);

    const tenantConfig = JSON.parse(fs.readFileSync(path.join(summary.migrated[0].tenantRoot, `config.json`), `utf8`));
    assert.equal(tenantConfig.tenantId, `aaaaaaaaaaaa`);
    assert.equal(tenantConfig.tenantDomain, `example.com`);
    assert.equal(tenantConfig.defaultAppName, `admin`);
    assert.deepEqual(tenantConfig.alias, [`alias.test`]);

    const appNames = summary.migrated[0].apps.map((entry) => entry.appName).sort();
    assert.deepEqual(appNames, [`admin`, `www`]);
    for (const app of summary.migrated[0].apps) {
      assert.equal(path.basename(app.appRoot), `app_${app.appName}`);
      const appConfig = JSON.parse(fs.readFileSync(path.join(app.appRoot, `config`, `app.json`), `utf8`));
      assert.equal(appConfig.appId, app.appId);
      assert.equal(appConfig.appName, app.appName);
    }
  } finally {
    fs.rmSync(tenantsBase, { recursive: true, force: true });
  }
});

test(`default tenancy scan rejects non-canonical tenant folder names after the canonical-layout cutover`, async () => {
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-reject-legacy`
    },
    routeMatcherCompiler: createTestTenantRouteMatcherCompiler(),
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-reject-legacy`) {
          return [createDirentMock(`example.com`, { directory: true })];
        }
        return [];
      }
    }
  });

  assert.equal(summary.registry.hosts.size, 0);
  assert.equal(summary.registry.domains.size, 0);
  assert.equal(summary.invalidHosts.length, 1);
  assert.equal(summary.invalidHosts[0].scope, `tenant`);
  assert.equal(summary.invalidHosts[0].host, `example.com`);
});

test(`default tenancy scan rejects app folders whose canonical appName does not match the folder name`, async () => {
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-duplicate-app-name`
    },
    routeMatcherCompiler: createTestTenantRouteMatcherCompiler(),
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-duplicate-app-name`) {
          return [createDirentMock(`tenant_example.com`, { directory: true })];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com`) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`app_www`, { directory: true }),
            createDirentMock(`app_admin`, { directory: true })
          ];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com/app_www/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com/app_admin/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com/config.json`) {
          return JSON.stringify({
            tenantId: `aaaaaaaaaaaa`,
            tenantDomain: `example.com`,
            defaultAppName: `www`
          });
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com/app_www/config/app.json`) {
          return JSON.stringify({
            appId: `bbbbbbbbbbbb`,
            appName: `www`,
            routesAvailable: {
              '/hello': {
                pointsTo: `run > hello@index`
              }
            }
          });
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_example.com/app_admin/config/app.json`) {
          return JSON.stringify({
            appId: `cccccccccccc`,
            appName: `www`,
            routesAvailable: {
              '/hello': {
                pointsTo: `run > other@index`
              }
            }
          });
        }
        const error = new Error(`Unexpected readFile path: ${targetPath}`);
        error.code = `ENOENT`;
        throw error;
      }
    }
  });

  assert.equal(summary.registry.hosts.size, 1);
  assert.deepEqual(summary.registry.domains.get(`example.com`)?.appNames, [`www`]);
  assert.equal(summary.invalidHosts.length, 1);
  assert.equal(summary.invalidHosts[0].host, `app_admin.example.com`);
  assert.match(summary.invalidHosts[0].error.message, /appName does not match folder name/);
});

test(`tenant registry resolver mirrors active tenant and app folders into the runtime registry with persisted identity snapshots`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-registry-snapshot-`));
  const tenantsPath = path.join(baseDir, `tenants`);
  const registryPath = path.join(baseDir, `registry`);
  const tenantRoot = path.join(tenantsPath, `tenant_example.com`);
  const appRoot = path.join(tenantRoot, `app_www`);

  try {
    fs.mkdirSync(appRoot, { recursive: true });

    await defaultTenantRegistryResolverAdapter.persistRegistryAdapter({
      storage: {
        async createFolder(targetPath) {
          await fs.promises.mkdir(targetPath, { recursive: true });
        },
        async writeFile(targetPath, content) {
          await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.promises.writeFile(targetPath, content, `utf8`);
        }
      },
      tenantsPath,
      registryPath,
      snapshotMetadata: {
        installId: `installabc123`,
        ehecoatlVersion: `0.0.1-alpha`
      },
      registry: {
        domains: new Map([
          [`example.com`, {
            tenantId: `aaaaaaaaaaaa`,
            domain: `example.com`,
            rootFolder: tenantRoot,
            appRouting: { mode: `subdomain`, defaultAppName: `www` },
            appNames: [`www`]
          }]
        ]),
        hosts: new Map([
          [`www.example.com`, {
            host: `www.example.com`,
            tenantId: `aaaaaaaaaaaa`,
            appId: `bbbbbbbbbbbb`,
            domain: `example.com`,
            appName: `www`,
            methodsAvailable: [`GET`],
            routesAvailable: {
              '/hello': { pointsTo: `run > hello@index` }
            },
            compiledRoutes: [{ type: `exact`, routePath: `/hello` }],
            rootFolder: appRoot,
            actionsRootFolder: path.join(appRoot, `actions`),
            assetsRootFolder: path.join(appRoot, `assets`),
            httpMiddlewaresRootFolder: path.join(appRoot, `app`, `http`, `middlewares`),
            wsMiddlewaresRootFolder: path.join(appRoot, `app`, `ws`, `middlewares`),
            routesRootFolder: path.join(appRoot, `routes`)
          }]
        ])
      }
    });

    const tenantSnapshotPath = path.join(
      registryPath,
      `tenant_aaaaaaaaaaaa`,
      `snapshot_aaaaaaaaaaaa.json`
    );
    const appSnapshotPath = path.join(
      registryPath,
      `tenant_aaaaaaaaaaaa`,
      `app_bbbbbbbbbbbb`,
      `snapshot_aaaaaaaaaaaa_bbbbbbbbbbbb.json`
    );
    const tenantConfig = JSON.parse(
      fs.readFileSync(tenantSnapshotPath, `utf8`)
    );
    const appConfig = JSON.parse(
      fs.readFileSync(appSnapshotPath, `utf8`)
    );

    assert.equal(fs.existsSync(path.join(registryPath, `tenant_aaaaaaaaaaaa`, `config.json`)), false);
    assert.equal(fs.existsSync(path.join(registryPath, `tenant_aaaaaaaaaaaa`, `app_bbbbbbbbbbbb`, `config.json`)), false);
    assert.equal(tenantConfig.tenantId, `aaaaaaaaaaaa`);
    assert.equal(tenantConfig.installId, `installabc123`);
    assert.equal(tenantConfig.ehecoatlVersion, `0.0.1-alpha`);
    assert.match(tenantConfig.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(tenantConfig.tenantDomain, `example.com`);
    assert.equal(tenantConfig.appRouting.mode, `subdomain`);
    assert.deepEqual(tenantConfig.appNames, [`www`]);

    assert.equal(appConfig.appId, `bbbbbbbbbbbb`);
    assert.equal(appConfig.installId, `installabc123`);
    assert.equal(appConfig.ehecoatlVersion, `0.0.1-alpha`);
    assert.match(appConfig.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(appConfig.appName, `www`);
    assert.equal(appConfig.domain, `example.com`);
    assert.deepEqual(appConfig.methodsAvailable, [`GET`]);
    assert.deepEqual(appConfig.routesAvailable, {
      '/hello': { pointsTo: `run > hello@index` }
    });
    assert.deepEqual(appConfig.compiledRoutes, [{ type: `exact`, routePath: `/hello` }]);
    assert.equal(appConfig.source.appFolder, appRoot);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test(`default tenancy scan rejects tenant configs with missing or mismatched ehecoatlVersion`, async () => {
  const missingVersion = await scanVersionFixture({
    tenantVersion: undefined,
    appVersion: expectedRuntimeVersion
  });
  const mismatchedVersion = await scanVersionFixture({
    tenantVersion: `0.0.0-old`,
    appVersion: expectedRuntimeVersion
  });

  assert.equal(missingVersion.registry.domains.size, 0);
  assert.equal(missingVersion.invalidHosts.length, 1);
  assert.equal(missingVersion.invalidHosts[0].scope, `tenant`);
  assert.equal(missingVersion.invalidHosts[0].error.code, `EHECOATL_VERSION_MISSING`);
  assert.match(missingVersion.invalidHosts[0].error.message, /missing ehecoatlVersion/);

  assert.equal(mismatchedVersion.registry.domains.size, 0);
  assert.equal(mismatchedVersion.invalidHosts.length, 1);
  assert.equal(mismatchedVersion.invalidHosts[0].scope, `tenant`);
  assert.equal(mismatchedVersion.invalidHosts[0].error.code, `EHECOATL_VERSION_MISMATCH`);
  assert.match(mismatchedVersion.invalidHosts[0].error.message, /ehecoatlVersion mismatch/);
});

test(`default tenancy scan accepts matching tenant and merged app ehecoatlVersion`, async () => {
  const directAppVersion = await scanVersionFixture({
    tenantVersion: expectedRuntimeVersion,
    appVersion: expectedRuntimeVersion
  });
  const sharedAppVersion = await scanVersionFixture({
    tenantVersion: expectedRuntimeVersion,
    sharedVersion: expectedRuntimeVersion,
    appVersion: undefined
  });

  assert.equal(directAppVersion.invalidHosts.length, 0);
  assert.equal(directAppVersion.registry.domains.get(`example.com`)?.ehecoatlVersion, expectedRuntimeVersion);
  assert.equal(directAppVersion.registry.hosts.get(`www.example.com`)?.ehecoatlVersion, expectedRuntimeVersion);

  assert.equal(sharedAppVersion.invalidHosts.length, 0);
  assert.equal(sharedAppVersion.registry.hosts.get(`www.example.com`)?.ehecoatlVersion, expectedRuntimeVersion);
});

test(`default tenancy scan rejects missing or mismatched merged app ehecoatlVersion`, async () => {
  const missingVersion = await scanVersionFixture({
    tenantVersion: expectedRuntimeVersion,
    appVersion: undefined
  });
  const mismatchedVersion = await scanVersionFixture({
    tenantVersion: expectedRuntimeVersion,
    appVersion: `0.0.0-old`
  });
  const sharedVersionOverridden = await scanVersionFixture({
    tenantVersion: expectedRuntimeVersion,
    sharedVersion: expectedRuntimeVersion,
    appVersion: `0.0.0-old`
  });

  for (const summary of [missingVersion, mismatchedVersion, sharedVersionOverridden]) {
    assert.equal(summary.registry.hosts.size, 0);
    assert.equal(summary.invalidHosts.length, 1);
    assert.equal(summary.invalidHosts[0].scope, `app`);
    assert.equal(summary.invalidHosts[0].host, `app_www.example.com`);
  }
  assert.equal(missingVersion.invalidHosts[0].error.code, `EHECOATL_VERSION_MISSING`);
  assert.equal(mismatchedVersion.invalidHosts[0].error.code, `EHECOATL_VERSION_MISMATCH`);
  assert.equal(sharedVersionOverridden.invalidHosts[0].error.code, `EHECOATL_VERSION_MISMATCH`);
  assert.match(missingVersion.invalidHosts[0].error.message, /missing ehecoatlVersion/);
  assert.match(mismatchedVersion.invalidHosts[0].error.message, /ehecoatlVersion mismatch/);
  assert.match(sharedVersionOverridden.invalidHosts[0].error.message, /ehecoatlVersion mismatch/);
});

test(`tenant layout deploy patch commands preserve existing and missing ehecoatlVersion values`, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-version-patch-`));

  try {
    const tenantWithVersionPath = path.join(tempDir, `tenant-version.json`);
    const tenantWithoutVersionPath = path.join(tempDir, `tenant-missing.json`);
    const appWithVersionPath = path.join(tempDir, `app-version.json`);
    const appWithoutVersionPath = path.join(tempDir, `app-missing.json`);

    fs.writeFileSync(tenantWithVersionPath, JSON.stringify({ ehecoatlVersion: expectedRuntimeVersion }), `utf8`);
    fs.writeFileSync(tenantWithoutVersionPath, JSON.stringify({}), `utf8`);
    fs.writeFileSync(appWithVersionPath, JSON.stringify({ ehecoatlVersion: expectedRuntimeVersion }), `utf8`);
    fs.writeFileSync(appWithoutVersionPath, JSON.stringify({}), `utf8`);

    execFileSync(process.execPath, [tenantLayoutCliPath, `patch-tenant-config`, tenantWithVersionPath, `aaaaaaaaaaaa`, `example.com`]);
    execFileSync(process.execPath, [tenantLayoutCliPath, `patch-tenant-config`, tenantWithoutVersionPath, `aaaaaaaaaaaa`, `example.com`]);
    execFileSync(process.execPath, [tenantLayoutCliPath, `patch-app-config`, appWithVersionPath, `bbbbbb`, `www`]);
    execFileSync(process.execPath, [tenantLayoutCliPath, `patch-app-config`, appWithoutVersionPath, `bbbbbb`, `www`]);

    assert.equal(JSON.parse(fs.readFileSync(tenantWithVersionPath, `utf8`)).ehecoatlVersion, expectedRuntimeVersion);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(tenantWithoutVersionPath, `utf8`)), `ehecoatlVersion`), false);
    assert.equal(JSON.parse(fs.readFileSync(appWithVersionPath, `utf8`)).ehecoatlVersion, expectedRuntimeVersion);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(appWithoutVersionPath, `utf8`)), `ehecoatlVersion`), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function scanVersionFixture({
  tenantVersion,
  sharedVersion,
  appVersion
}) {
  const basePath = `/tmp/tenancy-version-${Math.random().toString(16).slice(2)}`;
  const tenantRoot = `${basePath}/tenant_example.com`;
  const appRoot = `${tenantRoot}/app_www`;
  const sharedConfigRoot = `${tenantRoot}/shared/config`;
  const appConfigRoot = `${appRoot}/config`;

  return await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: basePath,
      ehecoatlVersion: expectedRuntimeVersion
    },
    routeMatcherCompiler: createTestTenantRouteMatcherCompiler(),
    storage: {
      async listEntries(targetPath) {
        if (targetPath === basePath) {
          return [createDirentMock(`tenant_example.com`, { directory: true })];
        }
        if (targetPath === tenantRoot) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`shared`, { directory: true }),
            createDirentMock(`app_www`, { directory: true })
          ];
        }
        if (targetPath === sharedConfigRoot) {
          return sharedVersion === undefined ? [] : [createDirentMock(`runtime.json`, { file: true })];
        }
        if (targetPath === appConfigRoot) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `${tenantRoot}/config.json`) {
          return JSON.stringify({
            tenantId: `aaaaaaaaaaaa`,
            tenantDomain: `example.com`,
            ...(tenantVersion === undefined ? {} : { ehecoatlVersion: tenantVersion })
          });
        }
        if (targetPath === `${sharedConfigRoot}/runtime.json`) {
          return JSON.stringify({
            ehecoatlVersion: sharedVersion
          });
        }
        if (targetPath === `${appConfigRoot}/app.json`) {
          return JSON.stringify({
            appId: `bbbbbb`,
            appName: `www`,
            ...(appVersion === undefined ? {} : { ehecoatlVersion: appVersion }),
            routesAvailable: {
              '/hello': {
                pointsTo: `run > hello@index`
              }
            }
          });
        }
        const error = new Error(`Unexpected readFile path: ${targetPath}`);
        error.code = `ENOENT`;
        throw error;
      },
      async writeFile() { },
      async deleteFile() { }
    }
  });
}

function createTestTenantRouteMatcherCompiler() {
  return {
    async compileRoutes(routesAvailable) {
      return defaultRouteMatcherCompilerAdapter.compileRoutesAdapter({
        routesAvailable
      });
    }
  };
}

function createDirentMock(name, { directory = false, file = false } = {}) {
  return {
    name,
    isDirectory() {
      return directory;
    },
    isFile() {
      return file;
    }
  };
}
