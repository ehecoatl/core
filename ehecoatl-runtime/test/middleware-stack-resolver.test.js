'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const MiddlewareStackResolver = require(`@/_core/resolvers/middleware-stack-resolver`);
const weakRequire = require(`@/utils/module/weak-require`);

test.afterEach(() => {
  weakRequire.clearAll();
});

test(`middleware-stack-resolver eagerly loads core middleware during initialize and defers tenant middleware until explicit access`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-resolver-`));
  const coreHttpMiddlewaresRoot = path.join(tempRoot, `middlewares`, `http`);
  const coreWsMiddlewaresRoot = path.join(tempRoot, `middlewares`, `ws`);
  const tenantHttpRoot = path.join(tempRoot, `tenant`, `http`, `middlewares`);
  const tenantWsRoot = path.join(tempRoot, `tenant`, `ws`, `middlewares`);

  fs.mkdirSync(coreHttpMiddlewaresRoot, { recursive: true });
  fs.mkdirSync(coreWsMiddlewaresRoot, { recursive: true });
  fs.mkdirSync(tenantHttpRoot, { recursive: true });
  fs.mkdirSync(tenantWsRoot, { recursive: true });
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `core.js`), `module.exports = Object.freeze(['core-alpha', 'core-beta']);\n`);
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `core-alpha.js`), "'use strict'; module.exports = () => 'alpha';\n");
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `_helper.js`), "'use strict'; module.exports = () => 'helper';\n");
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `core-beta.js`), "'use strict'; module.exports = () => 'beta';\n");
  fs.writeFileSync(path.join(coreWsMiddlewaresRoot, `core.js`), `module.exports = Object.freeze(['core-socket']);\n`);
  fs.writeFileSync(path.join(coreWsMiddlewaresRoot, `core-socket.js`), "'use strict'; module.exports = () => 'socket';\n");
  fs.writeFileSync(path.join(tenantHttpRoot, `tenant-http.js`), "'use strict'; module.exports = () => 'tenant-http';\n");
  fs.writeFileSync(path.join(tenantWsRoot, `tenant-ws.js`), "'use strict'; module.exports = () => 'tenant-ws';\n");

  const resolver = new MiddlewareStackResolver({
    config: {
      adapters: {
        tenantDirectoryResolver: {
          tenantsPath: path.join(tempRoot, `tenants`)
        }
      }
    },
    tenantId: `aaaaaaaaaaaa`,
    coreMiddlewarePaths: {
      http: coreHttpMiddlewaresRoot,
      ws: coreWsMiddlewaresRoot
    },
    tenantMiddlewarePaths: {
      http: tenantHttpRoot,
      ws: tenantWsRoot
    }
  });

  await resolver.initialize();

  assert.deepEqual(resolver.getCoreMiddlewareOrder(`http`), [`core-alpha`, `core-beta`]);
  assert.deepEqual(Object.keys(resolver.getCoreMiddlewares(`http`)), [`core-alpha`, `core-beta`]);
  assert.deepEqual(resolver.getCoreMiddlewareOrder(`ws`), [`core-socket`]);
  assert.deepEqual(Object.keys(resolver.getCoreMiddlewares(`ws`)), [`core-socket`]);
  assert.deepEqual(Object.keys(resolver.getTenantMiddlewares().http), []);
  assert.notEqual(require.cache[path.join(coreHttpMiddlewaresRoot, `core-alpha.js`)], undefined);
  assert.notEqual(require.cache[path.join(coreWsMiddlewaresRoot, `core-socket.js`)], undefined);
  assert.equal(require.cache[path.join(tenantHttpRoot, `tenant-http.js`)], undefined);

  const httpCoreOrder = await resolver.loadCoreMiddlewareOrder(`http`);
  const httpCoreRegistry = await resolver.loadCoreMiddlewares(`http`);
  const wsCoreOrder = await resolver.loadCoreMiddlewareOrder(`ws`);
  const wsCoreRegistry = await resolver.loadCoreMiddlewares(`ws`);
  const tenantRegistry = await resolver.loadTenantMiddlewares();

  assert.deepEqual(httpCoreOrder, [`core-alpha`, `core-beta`]);
  assert.deepEqual(Object.keys(httpCoreRegistry), [`core-alpha`, `core-beta`]);
  assert.deepEqual(wsCoreOrder, [`core-socket`]);
  assert.deepEqual(Object.keys(wsCoreRegistry), [`core-socket`]);
  assert.deepEqual(Object.keys(tenantRegistry.http), [`tenant-http`]);
  assert.deepEqual(Object.keys(tenantRegistry.ws), [`tenant-ws`]);
});

test(`middleware-stack-resolver reloads tenant middleware registries when source files change`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-tenant-watch-`));
  const coreHttpMiddlewaresRoot = path.join(tempRoot, `middlewares`, `http`);
  const coreWsMiddlewaresRoot = path.join(tempRoot, `middlewares`, `ws`);
  const tenantHttpRoot = path.join(tempRoot, `tenant`, `http`, `middlewares`);
  const tenantWsRoot = path.join(tempRoot, `tenant`, `ws`, `middlewares`);
  const tenantHttpPath = path.join(tenantHttpRoot, `tenant-http.js`);

  fs.mkdirSync(coreHttpMiddlewaresRoot, { recursive: true });
  fs.mkdirSync(coreWsMiddlewaresRoot, { recursive: true });
  fs.mkdirSync(tenantHttpRoot, { recursive: true });
  fs.mkdirSync(tenantWsRoot, { recursive: true });
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `core.js`), `module.exports = Object.freeze(['core-alpha']);\n`);
  fs.writeFileSync(path.join(coreHttpMiddlewaresRoot, `core-alpha.js`), "'use strict'; module.exports = () => 'alpha';\n");
  fs.writeFileSync(path.join(coreWsMiddlewaresRoot, `core.js`), `module.exports = Object.freeze([]);\n`);
  fs.writeFileSync(tenantHttpPath, "'use strict'; module.exports = () => 'tenant-http:first';\n");

  const resolver = new MiddlewareStackResolver({
    config: {
      adapters: {
        tenantDirectoryResolver: {
          tenantsPath: path.join(tempRoot, `tenants`)
        }
      }
    },
    tenantId: `aaaaaaaaaaaa`,
    coreMiddlewarePaths: {
      http: coreHttpMiddlewaresRoot,
      ws: coreWsMiddlewaresRoot
    },
    tenantMiddlewarePaths: {
      http: tenantHttpRoot,
      ws: tenantWsRoot
    }
  });

  await resolver.initialize();
  const firstLoad = await resolver.loadTenantMiddlewares();
  writeModuleAndAdvanceMtime(tenantHttpPath, "'use strict'; module.exports = () => 'tenant-http:second';\n");
  const secondLoad = await resolver.loadTenantMiddlewares();

  assert.equal(firstLoad.http[`tenant-http`](), `tenant-http:first`);
  assert.equal(secondLoad.http[`tenant-http`](), `tenant-http:second`);

  fs.rmSync(tenantHttpPath, { force: true });
  const thirdLoad = await resolver.loadTenantMiddlewares();
  assert.deepEqual(Object.keys(thirdLoad.http), []);
});

test(`middleware-stack-resolver reloads app middleware registries for the current tenant`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-app-`));
  const tenantsBase = path.join(tempRoot, `tenants`);
  const tenantRoot = path.join(tenantsBase, `tenant_example.com`);
  const appRoot = path.join(tenantRoot, `app_www`);
  const appHttpRoot = path.join(appRoot, `app`, `http`, `middlewares`);
  const appWsRoot = path.join(appRoot, `app`, `ws`, `middlewares`);
  const appHttpPath = path.join(appHttpRoot, `auth.js`);

  fs.mkdirSync(appHttpRoot, { recursive: true });
  fs.mkdirSync(appWsRoot, { recursive: true });
  fs.writeFileSync(path.join(tenantRoot, `config.json`), JSON.stringify({
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.com`
  }, null, 2));
  fs.writeFileSync(path.join(appRoot, `config.json`), JSON.stringify({
    appId: `bbbbbbbbbbbb`,
    appName: `www`
  }, null, 2));
  fs.writeFileSync(appHttpPath, "'use strict'; module.exports = () => 'auth:first';\n");
  fs.writeFileSync(path.join(appWsRoot, `socket-auth.js`), "'use strict'; module.exports = () => 'socket-auth';\n");

  const resolver = new MiddlewareStackResolver({
    config: {
      adapters: {
        tenantDirectoryResolver: {
          tenantsPath: tenantsBase
        }
      }
    },
    tenantId: `aaaaaaaaaaaa`,
    tenantsBase,
    tenantMiddlewarePaths: {
      http: path.join(tempRoot, `missing`, `http`),
      ws: path.join(tempRoot, `missing`, `ws`)
    },
    appMiddlewarePathsResolver: ({ appRecord }) => ({
      http: path.join(appRecord.appRoot, `app`, `http`, `middlewares`),
      ws: path.join(appRecord.appRoot, `app`, `ws`, `middlewares`)
    })
  });

  await resolver.initialize();
  const firstLoad = await resolver.loadAppMiddlewares(`bbbbbbbbbbbb`);
  writeModuleAndAdvanceMtime(appHttpPath, "'use strict'; module.exports = () => 'auth:second';\n");
  const secondLoad = await resolver.loadAppMiddlewares(`bbbbbbbbbbbb`);

  assert.deepEqual(Object.keys(firstLoad.http), [`auth`]);
  assert.deepEqual(Object.keys(firstLoad.ws), [`socket-auth`]);
  assert.equal(firstLoad.http.auth(), `auth:first`);
  assert.equal(secondLoad.http.auth(), `auth:second`);
  assert.equal(resolver.getAppMiddlewares(`bbbbbbbbbbbb`), secondLoad);

  fs.rmSync(appHttpPath, { force: true });
  const thirdLoad = await resolver.loadAppMiddlewares(`bbbbbbbbbbbb`);
  assert.deepEqual(Object.keys(thirdLoad.http), []);
});

test(`middleware-stack-resolver fails clearly when loading an app outside the current tenant`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-missing-app-`));
  const resolver = new MiddlewareStackResolver({
    config: {
      adapters: {
        tenantDirectoryResolver: {
          tenantsPath: path.join(tempRoot, `tenants`)
        }
      }
    },
    tenantId: `aaaaaaaaaaaa`,
    tenantsBase: path.join(tempRoot, `tenants`),
    tenantMiddlewarePaths: {
      http: path.join(tempRoot, `missing`, `http`),
      ws: path.join(tempRoot, `missing`, `ws`)
    }
  });

  await resolver.initialize();

  await assert.rejects(
    resolver.loadAppMiddlewares(`bbbbbbbbbbbb`),
    /is not present inside transport tenant/
  );
});

function writeModuleAndAdvanceMtime(filePath, source) {
  fs.writeFileSync(filePath, source);
  const currentStat = fs.statSync(filePath);
  const nextMtimeMs = Math.max(Date.now(), Math.ceil(currentStat.mtimeMs) + 1000);
  const nextMtime = new Date(nextMtimeMs);
  fs.utimesSync(filePath, nextMtime, nextMtime);
}
