'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const defaultRouteMatcherCompilerAdapter = require(`@adapter/inbound/tenant-route-matcher-compiler/default-routing-v1`);
const defaultUriRouterRuntimeAdapter = require(`@adapter/inbound/request-uri-routing-runtime/default-uri-router-runtime`);

test(`route compiler rejects duplicate canonical routes after trailing-slash normalization`, async () => {
  await assert.rejects(
    defaultRouteMatcherCompilerAdapter.compileRoutesAdapter({
      routesAvailable: {
        '/ws': {
          authScope: null,
          middlewares: []
        },
        '/ws/': {
          authScope: null,
          middlewares: []
        }
      }
    }),
    /Duplicate canonical route "\/ws"/
  );
});

test(`route compiler supports explicit routes groups with inherited merge rules`, async () => {
  const compiled = await defaultRouteMatcherCompilerAdapter.compileRoutesAdapter({
    routesAvailable: {
      '/ws': {
        pointsTo: `run > ws@index`,
        middlewares: [`tenant-auth`, `audit`],
        session: true,
        contentTypes: [`application/json`, `text/plain`],
        upload: {
          uploadTypes: [`image/png`],
          diskLimitBytes: 4096
        },
        upgrade: {
          enabled: true,
          transport: [`websocket`],
          wsActionsAvailable: [`parent@index`],
          room: `lobby`
        },
        routes: {
          '/auth/': {
            middlewares: [`auth`, `tenant-auth`],
            session: null,
            contentTypes: [`text/html`, `application/json`],
            upload: {
              uploadTypes: [`image/jpeg`],
              diskLimitBytes: null
            },
            upgrade: {
              wsActionsAvailable: [`child@index`],
              room: null
            },
            pointsTo: `run > ws-auth@index`
          }
        }
      }
    }
  });

  assert.deepEqual(Object.keys(compiled.routesAvailable), [`/ws`, `/ws/auth`]);
  assert.deepEqual(compiled.routesAvailable[`/ws`].middleware, [`tenant-auth`, `audit`]);
  assert.deepEqual(compiled.routesAvailable[`/ws/auth`].middleware, [`auth`, `tenant-auth`, `audit`]);
  assert.equal(compiled.routesAvailable[`/ws/auth`].session, true);
  assert.deepEqual(compiled.routesAvailable[`/ws/auth`].contentTypes, [`text/html`, `application/json`, `text/plain`]);
  assert.deepEqual(compiled.routesAvailable[`/ws/auth`].upload, {
    uploadPath: null,
    uploadTypes: [`image/jpeg`, `image/png`],
    diskLimit: null,
    diskLimitBytes: 4096
  });
  assert.deepEqual(compiled.routesAvailable[`/ws/auth`].upgrade, {
    enabled: true,
    transport: [`websocket`],
    authScope: null,
    wsActionsAvailable: [`child@index`, `parent@index`],
    room: `lobby`,
    description: null
  });
});

test(`route compiler keeps implicit prefix groups compatible while canonicalizing child paths`, async () => {
  const compiled = await defaultRouteMatcherCompilerAdapter.compileRoutesAdapter({
    routesAvailable: {
      '/api': {
        middlewares: [`auth`],
        '/users/': {
          pointsTo: `run > users@index`
        }
      }
    }
  });

  assert.deepEqual(Object.keys(compiled.routesAvailable), [`/api/users`]);
  assert.deepEqual(compiled.routesAvailable[`/api/users`].middleware, [`auth`]);
});

test(`uri router resolves canonical matches for both /ws and /ws/ on websocket routes`, async () => {
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

  const canonicalMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.example.com/ws`,
    registry,
    defaultAppName: `www`,
    routeType: `ws-upgrade`
  });
  const slashMatch = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.example.com/ws/`,
    registry,
    defaultAppName: `www`,
    routeType: `ws-upgrade`
  });

  assert.equal(canonicalMatch?.upgrade?.enabled, true);
  assert.equal(slashMatch?.upgrade?.enabled, true);
  assert.deepEqual(slashMatch?.middleware, [`auth`]);
  assert.deepEqual(canonicalMatch?.params, {});
  assert.deepEqual(slashMatch?.params, {});
});

test(`uri router preserves dynamic params while keeping legacy replacements active`, async () => {
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
        compiledRoutes: [{
          type: 1,
          regexp: /^\/blog\/([^/]+)$/,
          keys: [`slug`],
          route_data: {
            pointsTo: `run > blog@show`,
            target: {
              type: `asset`,
              value: `blog/{slug}.e.html`,
              asset: {
                path: `blog/{slug}.e.html`
              }
            },
            methodsAvailable: [`GET`],
            methods: [`GET`]
          }
        }]
      })]
    ])
  };

  const match = await defaultUriRouterRuntimeAdapter.matchRouteAdapter({
    url: `www.example.com/blog/post-1`,
    registry,
    defaultAppName: `www`
  });

  assert.deepEqual(match?.params, { slug: `post-1` });
  assert.equal(match?.target?.asset?.path, `blog/post-1.e.html`);
});

function buildRouteData({
  host,
  tenantId,
  appId,
  domain,
  appName,
  compiledRoutes = [],
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
