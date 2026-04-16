// test/tenant-layout-migration.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const defaultTenancyAdapter = require(`@adapter/outbound/tenant-directory-resolver/default-tenancy`);
const defaultTenantRegistryResolverAdapter = require(`@adapter/outbound/tenant-registry-resolver/default-runtime-registry-v1`);
const defaultRouteMatcherCompilerAdapter = require(`@adapter/outbound/tenant-route-matcher-compiler/default-routing-v1`);
const {
  tenantDirPrefix,
  generateUniqueOpaqueId,
  migrateLegacyTenantsSync
} = require(`@/utils/tenancy/tenant-layout`);

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

test(`migrateLegacyTenantsSync rewrites legacy tenant and app folders to opaque ids and preserves routing identity in config`, () => {
  const tenantsBase = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-layout-`));

  try {
    fs.writeFileSync(path.join(tenantsBase, `alias.test`), JSON.stringify({
      enabled: true,
      point: `example.com`
    }));

    const legacyTenantRoot = path.join(tenantsBase, `example.com`);
    const legacyAppRoot = path.join(legacyTenantRoot, `www`);
    const legacyAdminRoot = path.join(legacyTenantRoot, `admin`);
    fs.mkdirSync(legacyAppRoot, { recursive: true });
    fs.mkdirSync(legacyAdminRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyTenantRoot, `config.json`), JSON.stringify({
      appRoutingMode: `path`,
      defaultAppName: `admin`
    }));
    fs.writeFileSync(path.join(legacyAppRoot, `config.json`), JSON.stringify({
      methodsAvailable: [`GET`]
    }));
    fs.writeFileSync(path.join(legacyAdminRoot, `config.json`), JSON.stringify({
      methodsAvailable: [`GET`, `POST`]
    }));

    const summary = migrateLegacyTenantsSync({ tenantsBase });

    assert.equal(summary.aliasesMigrated.length, 1);
    assert.equal(summary.migrated.length, 1);
    assert.match(path.basename(summary.migrated[0].tenantRoot), /^tenant_[a-z0-9]{12}$/);
    assert.equal(summary.migrated[0].tenantDomain, `example.com`);
    assert.equal(summary.migrated[0].apps.length, 2);

    const tenantConfig = JSON.parse(fs.readFileSync(path.join(summary.migrated[0].tenantRoot, `config.json`), `utf8`));
    assert.match(tenantConfig.tenantId, /^[a-z0-9]{12}$/);
    assert.equal(tenantConfig.tenantDomain, `example.com`);
    assert.equal(tenantConfig.defaultAppName, `admin`);
    assert.deepEqual(tenantConfig.alias, [`alias.test`]);
    assert.equal(fs.existsSync(path.join(tenantsBase, `alias.test`)), false);

    const appNames = summary.migrated[0].apps.map((entry) => entry.appName).sort();
    assert.deepEqual(appNames, [`admin`, `www`]);
    for (const app of summary.migrated[0].apps) {
      assert.match(path.basename(app.appRoot), /^app_[a-z0-9]{12}$/);
      const appConfig = JSON.parse(fs.readFileSync(path.join(app.appRoot, `config`, `app.json`), `utf8`));
      assert.equal(appConfig.appId, app.appId);
      assert.equal(appConfig.appName, app.appName);
      assert.equal(fs.existsSync(path.join(app.appRoot, `config.json`)), false);
    }
  } finally {
    fs.rmSync(tenantsBase, { recursive: true, force: true });
  }
});

test(`default tenancy scan rejects legacy tenant folder names after the opaque-layout cutover`, async () => {
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

test(`default tenancy scan rejects duplicate appName values within one opaque tenant`, async () => {
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-duplicate-app-name`
    },
    routeMatcherCompiler: createTestTenantRouteMatcherCompiler(),
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-duplicate-app-name`) {
          return [createDirentMock(`tenant_aaaaaaaaaaaa`, { directory: true })];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa`) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`app_bbbbbbbbbbbb`, { directory: true }),
            createDirentMock(`app_cccccccccccc`, { directory: true })
          ];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa/app_cccccccccccc/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa/config.json`) {
          return JSON.stringify({
            tenantId: `aaaaaaaaaaaa`,
            tenantDomain: `example.com`,
            defaultAppName: `www`
          });
        }
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config/app.json`) {
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
        if (targetPath === `/tmp/tenancy-duplicate-app-name/tenant_aaaaaaaaaaaa/app_cccccccccccc/config/app.json`) {
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

  assert.equal(summary.registry.hosts.size, 0);
  assert.equal(summary.registry.domains.get(`example.com`)?.appNames.length, 0);
  assert.equal(summary.invalidHosts.length, 2);
  assert.ok(summary.invalidHosts.every((entry) => entry.host === `www.example.com`));
});

test(`tenant registry resolver mirrors active tenant and app folders into the runtime registry with persisted config snapshots`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-registry-snapshot-`));
  const tenantsPath = path.join(baseDir, `tenants`);
  const registryPath = path.join(baseDir, `registry`);
  const tenantRoot = path.join(tenantsPath, `tenant_aaaaaaaaaaaa`);
  const appRoot = path.join(tenantRoot, `app_bbbbbbbbbbbb`);

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

    const tenantConfig = JSON.parse(
      fs.readFileSync(path.join(registryPath, `tenant_aaaaaaaaaaaa`, `config.json`), `utf8`)
    );
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(registryPath, `tenant_aaaaaaaaaaaa`, `app_bbbbbbbbbbbb`, `config.json`), `utf8`)
    );

    assert.equal(tenantConfig.tenantId, `aaaaaaaaaaaa`);
    assert.equal(tenantConfig.tenantDomain, `example.com`);
    assert.equal(tenantConfig.appRouting.mode, `subdomain`);
    assert.deepEqual(tenantConfig.appNames, [`www`]);

    assert.equal(appConfig.appId, `bbbbbbbbbbbb`);
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
