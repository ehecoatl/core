'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const defaultTenancyAdapter = require(`@adapter/inbound/tenant-directory-resolver/default-tenancy`);
const defaultUriRouterRuntimeAdapter = require(`@adapter/inbound/request-uri-routing-runtime/default-uri-router-runtime`);
const TenantDirectoryResolver = require(`@/_core/resolvers/tenant-directory-resolver/tenant-directory-resolver`);

test(`default tenancy scan merges tenant shared config with app config and ignores legacy root alias files`, async () => {
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-inline-alias`
    },
    routeMatcherCompiler: {
      async compileRoutes(routesAvailable) {
        return {
          routesAvailable,
          compiledRoutes: [{
            type: 0,
            pattern: `/`,
            route_data: {
              methodsAvailable: [`GET`],
              target: {
                run: {
                  resource: `home`,
                  action: `index`
                }
              }
            }
          }]
        };
      }
    },
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-inline-alias`) {
          return [
            createDirentMock(`legacy-alias.test`, { file: true }),
            createDirentMock(`tenant_aaaaaaaaaaaa`, { directory: true })
          ];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa`) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`shared`, { directory: true }),
            createDirentMock(`app_bbbbbbbbbbbb`, { directory: true })
          ];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/shared/config`) {
          return [createDirentMock(`shared.json`, { file: true })];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/config.json`) {
          return JSON.stringify({
            tenantId: `aaaaaaaaaaaa`,
            tenantDomain: `example.com`,
            alias: [`alias.test`]
          });
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/shared/config/shared.json`) {
          return JSON.stringify({
            appEnabled: true,
            routesAvailable: {
              '/': {
                pointsTo: `run > shared@index`
              }
            }
          });
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config/app.json`) {
          return JSON.stringify({
            appId: `bbbbbbbbbbbb`,
            appName: `www`,
            alias: [`short.test`]
          });
        }
        const error = new Error(`Unexpected readFile path: ${targetPath}`);
        error.code = `ENOENT`;
        throw error;
      }
    }
  });

  assert.equal(summary.registry.domainAliases.get(`alias.test`)?.point, `example.com`);
  assert.deepEqual(summary.registry.appAliases.get(`short.test`), {
    domain: `short.test`,
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.com`,
    appId: `bbbbbbbbbbbb`,
    appName: `www`
  });
  assert.deepEqual(summary.registry.hosts.get(`www.example.com`)?.routesAvailable, {
    '/': {
      pointsTo: `run > shared@index`
    }
  });
  assert.equal(summary.registry.domainAliases.has(`legacy-alias.test`), false);
});

test(`default tenancy scan keeps websocket upgrade routes separate from http compiled routes`, async () => {
  const compileCalls = [];
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-inline-alias`
    },
    routeMatcherCompiler: {
      async compileRoutes(routesAvailable) {
        compileCalls.push(routesAvailable);
        const compiledRoutes = Object.keys(routesAvailable ?? {}).map((pattern) => ({
          type: 0,
          pattern,
          route_data: routesAvailable[pattern]
        }));
        return { routesAvailable, compiledRoutes };
      }
    },
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-inline-alias`) {
          return [createDirentMock(`tenant_aaaaaaaaaaaa`, { directory: true })];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa`) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`app_bbbbbbbbbbbb`, { directory: true })
          ];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config`) {
          return [createDirentMock(`app.json`, { file: true })];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/routes/http`) {
          return [createDirentMock(`base.json`, { file: true })];
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/routes/ws`) {
          return [createDirentMock(`base.json`, { file: true })];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/config.json`) {
          return JSON.stringify({
            tenantId: `aaaaaaaaaaaa`,
            tenantDomain: `example.com`
          });
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config/app.json`) {
          return JSON.stringify({
            appId: `bbbbbbbbbbbb`,
            appName: `www`
          });
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/routes/http/base.json`) {
          return JSON.stringify({
            '/': {
              pointsTo: `run > home@index`
            }
          });
        }
        if (targetPath === `/tmp/tenancy-inline-alias/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/routes/ws/base.json`) {
          return JSON.stringify({
            '/ws': {
              middleware: [`auth`],
              authScope: null
            }
          });
        }
        const error = new Error(`Unexpected readFile path: ${targetPath}`);
        error.code = `ENOENT`;
        throw error;
      }
    }
  });

  assert.deepEqual(compileCalls[0], {
    '/': {
      pointsTo: `run > home@index`
    }
  });
  assert.deepEqual(compileCalls[1], {
    '/ws': {
      middleware: [`auth`],
      authScope: null,
      upgrade: {
        enabled: true,
        transport: [`websocket`],
        authScope: null,
        wsActionsAvailable: null,
        room: null,
        description: null
      }
    }
  });
  assert.deepEqual(summary.registry.hosts.get(`www.example.com`)?.compiledRoutes.map((entry) => entry.pattern), [`/`]);
  assert.deepEqual(summary.registry.hosts.get(`www.example.com`)?.compiledWsRoutes.map((entry) => entry.pattern), [`/ws`]);
});

test(`uri router resolves tenant aliases and direct app aliases without path-mode guessing`, async () => {
  const compiledRoutes = [{
    type: 0,
    pattern: `/dashboard`,
    route_data: {
      methodsAvailable: [`GET`],
      target: {
        run: {
          resource: `dashboard`,
          action: `index`
        }
      }
    }
  }];

  const registry = {
    domains: new Map([
      [`example.com`, {
        tenantId: `aaaaaaaaaaaa`,
        domain: `example.com`,
        rootFolder: `/tmp/tenant_aaaaaaaaaaaa`,
        appRouting: { mode: `subdomain`, defaultAppName: `www` },
        appNames: [`admin`, `www`],
        aliases: [`alias.test`]
      }]
    ]),
    domainAliases: new Map([
      [`alias.test`, { point: `example.com` }]
    ]),
    appAliases: new Map([
      [`admin-short.test`, {
        domain: `admin-short.test`,
        tenantId: `aaaaaaaaaaaa`,
        tenantDomain: `example.com`,
        appId: `bbbbbbbbbbbb`,
        appName: `admin`
      }]
    ]),
    hosts: new Map([
      [`www.example.com`, buildRouteData({
        host: `www.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `cccccccccccc`,
        domain: `example.com`,
        appName: `www`,
        compiledRoutes
      })],
      [`admin.example.com`, buildRouteData({
        host: `admin.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `bbbbbbbbbbbb`,
        domain: `example.com`,
        appName: `admin`,
        compiledRoutes
      })]
    ])
  };

  const tenantAliasMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.alias.test/dashboard`,
    registry,
    defaultAppName: `www`
  });
  assert.equal(tenantAliasMatch?.tenantId, `aaaaaaaaaaaa`);
  assert.equal(tenantAliasMatch?.appId, `cccccccccccc`);
  assert.equal(tenantAliasMatch?.origin?.hostname, `www.alias.test`);

  const appAliasMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `admin-short.test/dashboard`,
    registry,
    defaultAppName: `www`
  });
  assert.equal(appAliasMatch?.tenantId, `aaaaaaaaaaaa`);
  assert.equal(appAliasMatch?.appId, `bbbbbbbbbbbb`);
  assert.equal(appAliasMatch?.domainRoutingMode, `direct`);

  const forcedAppMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `example.com/dashboard`,
    tenantId: `aaaaaaaaaaaa`,
    forcedAppId: `bbbbbbbbbbbb`,
    registry,
    defaultAppName: `www`
  });
  assert.equal(forcedAppMatch?.tenantId, `aaaaaaaaaaaa`);
  assert.equal(forcedAppMatch?.appId, `bbbbbbbbbbbb`);
  assert.equal(forcedAppMatch?.domainRoutingMode, `direct`);
});

test(`uri router selects websocket compiled routes when routeType is ws-upgrade`, async () => {
  const registry = {
    domains: new Map([
      [`example.com`, {
        tenantId: `aaaaaaaaaaaa`,
        domain: `example.com`,
        rootFolder: `/tmp/tenant_aaaaaaaaaaaa`,
        appRouting: { mode: `subdomain`, defaultAppName: `www` },
        appNames: [`www`],
        aliases: []
      }]
    ]),
    domainAliases: new Map(),
    appAliases: new Map(),
    hosts: new Map([
      [`www.example.com`, buildRouteData({
        host: `www.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `bbbbbbbbbbbb`,
        domain: `example.com`,
        appName: `www`,
        compiledRoutes: [],
        compiledWsRoutes: [{
          type: 0,
          pattern: `/ws`,
          route_data: {
            middleware: [`auth`],
            upgrade: {
              enabled: true,
              transport: [`websocket`]
            },
            methodsAvailable: [`GET`],
            methods: [`GET`]
          }
        }]
      })]
    ])
  };

  const wsMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.example.com/ws`,
    registry,
    defaultAppName: `www`,
    routeType: `ws-upgrade`
  });

  const httpMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.example.com/ws`,
    registry,
    defaultAppName: `www`
  });

  assert.equal(wsMatch?.upgrade?.enabled, true);
  assert.deepEqual(wsMatch?.middleware, [`auth`]);
  assert.equal(httpMatch, null);
});

test(`buildTenantSourceMap generates tenant-only hosts for path mode and always keeps app aliases`, () => {
  const sourceMap = TenantDirectoryResolver.buildTenantSourceMapForTests({
    domains: new Map([
      [`example.com`, {
        tenantId: `aaaaaaaaaaaa`,
        domain: `example.com`,
        rootFolder: `/tmp/tenant_aaaaaaaaaaaa`,
        internalProxy: { httpPort: 14002, wsPort: 14003 },
        appRouting: { mode: `path`, defaultAppName: `www` },
        aliases: [`alias.test`]
      }]
    ]),
    hosts: new Map([
      [`www.example.com`, buildRouteData({
        host: `www.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `bbbbbbbbbbbb`,
        domain: `example.com`,
        appName: `www`,
        compiledRoutes: []
      })],
      [`admin.example.com`, buildRouteData({
        host: `admin.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `cccccccccccc`,
        domain: `example.com`,
        appName: `admin`,
        compiledRoutes: []
      })]
    ]),
    appAliases: new Map([
      [`admin-short.test`, {
        domain: `admin-short.test`,
        tenantId: `aaaaaaaaaaaa`,
        tenantDomain: `example.com`,
        appId: `cccccccccccc`,
        appName: `admin`
      }]
    ])
  });

  assert.equal(sourceMap.get(`example.com`)?.routeType, `tenant`);
  assert.equal(sourceMap.get(`www.example.com`)?.routeType, `tenant`);
  assert.equal(sourceMap.get(`alias.test`)?.routeType, `tenant`);
  assert.equal(sourceMap.get(`www.alias.test`)?.routeType, `tenant`);
  assert.equal(sourceMap.has(`admin.example.com`), false);
  assert.equal(sourceMap.get(`admin-short.test`)?.routeType, `app`);
  assert.equal(sourceMap.get(`admin-short.test`)?.forcedAppId, `cccccccccccc`);
});

test(`buildTenantSourceMap generates direct app hosts for subdomain mode across primary and tenant alias domains`, () => {
  const sourceMap = TenantDirectoryResolver.buildTenantSourceMapForTests({
    domains: new Map([
      [`example.com`, {
        tenantId: `aaaaaaaaaaaa`,
        domain: `example.com`,
        rootFolder: `/tmp/tenant_aaaaaaaaaaaa`,
        internalProxy: { httpPort: 14002, wsPort: 14003 },
        appRouting: { mode: `subdomain`, defaultAppName: `www` },
        aliases: [`alias.test`]
      }]
    ]),
    hosts: new Map([
      [`www.example.com`, buildRouteData({
        host: `www.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `bbbbbbbbbbbb`,
        domain: `example.com`,
        appName: `www`,
        compiledRoutes: []
      })],
      [`admin.example.com`, buildRouteData({
        host: `admin.example.com`,
        tenantId: `aaaaaaaaaaaa`,
        appId: `cccccccccccc`,
        domain: `example.com`,
        appName: `admin`,
        compiledRoutes: []
      })]
    ]),
    appAliases: new Map()
  });

  assert.equal(sourceMap.get(`example.com`)?.routeType, `app`);
  assert.equal(sourceMap.get(`example.com`)?.forcedAppId, `bbbbbbbbbbbb`);
  assert.equal(sourceMap.get(`www.example.com`)?.routeType, `app`);
  assert.equal(sourceMap.get(`www.example.com`)?.forcedAppId, `bbbbbbbbbbbb`);
  assert.equal(sourceMap.get(`admin.example.com`)?.routeType, `app`);
  assert.equal(sourceMap.get(`admin.example.com`)?.forcedAppId, `cccccccccccc`);
  assert.equal(sourceMap.get(`alias.test`)?.routeType, `app`);
  assert.equal(sourceMap.get(`www.alias.test`)?.routeType, `app`);
  assert.equal(sourceMap.get(`admin.alias.test`)?.routeType, `app`);
  assert.equal(sourceMap.get(`admin.alias.test`)?.forcedAppId, `cccccccccccc`);
});

test(`buildTenantSourceMap rejects host collisions between generated hosts and explicit app aliases`, () => {
  assert.throws(() => {
    TenantDirectoryResolver.buildTenantSourceMapForTests({
      domains: new Map([
        [`example.com`, {
          tenantId: `aaaaaaaaaaaa`,
          domain: `example.com`,
          rootFolder: `/tmp/tenant_aaaaaaaaaaaa`,
          internalProxy: { httpPort: 14002, wsPort: 14003 },
          appRouting: { mode: `subdomain`, defaultAppName: `www` },
          aliases: []
        }]
      ]),
      hosts: new Map([
        [`www.example.com`, buildRouteData({
          host: `www.example.com`,
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbbbbbbbb`,
          domain: `example.com`,
          appName: `www`,
          compiledRoutes: []
        })]
      ]),
      appAliases: new Map([
        [`www.example.com`, {
          domain: `www.example.com`,
          tenantId: `aaaaaaaaaaaa`,
          tenantDomain: `example.com`,
          appId: `cccccccccccc`,
          appName: `admin`
        }]
      ])
    });
  }, /conflicts/);
});

function buildRouteData({
  host,
  tenantId,
  appId,
  domain,
  appName,
  compiledRoutes,
  compiledWsRoutes = []
}) {
  return {
    host,
    tenantId,
    appId,
    domain,
    appName,
    rootFolder: `/tmp/${appName}`,
    actionsRootFolder: `/tmp/${appName}/actions`,
    assetsRootFolder: `/tmp/${appName}/assets`,
    httpMiddlewaresRootFolder: `/tmp/${appName}/app/http/middlewares`,
    wsMiddlewaresRootFolder: `/tmp/${appName}/app/ws/middlewares`,
    routesRootFolder: `/tmp/${appName}/routes`,
    compiledRoutes,
    compiledWsRoutes,
    methodsAvailable: [`GET`]
  };
}

function createDirentMock(name, {
  file = false,
  directory = false
} = {}) {
  return {
    name,
    isFile() {
      return file;
    },
    isDirectory() {
      return directory;
    }
  };
}
