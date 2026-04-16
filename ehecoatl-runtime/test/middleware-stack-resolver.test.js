'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const MiddlewareStackResolver = require(`@/_core/resolvers/middleware-stack-resolver`);

test(`middleware-stack-resolver eagerly loads core and tenant registries`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-resolver-`));
  const coreMiddlewaresRoot = path.join(tempRoot, `middlewares`);
  const tenantHttpRoot = path.join(tempRoot, `tenant`, `http`, `middlewares`);
  const tenantWsRoot = path.join(tempRoot, `tenant`, `ws`, `middlewares`);

  fs.mkdirSync(coreMiddlewaresRoot, { recursive: true });
  fs.mkdirSync(tenantHttpRoot, { recursive: true });
  fs.mkdirSync(tenantWsRoot, { recursive: true });
  fs.writeFileSync(path.join(coreMiddlewaresRoot, `core.js`), `module.exports = Object.freeze(['core-alpha', 'core-beta']);\n`);
  fs.writeFileSync(path.join(coreMiddlewaresRoot, `core-alpha.js`), "'use strict'; module.exports = () => 'alpha';\n");
  fs.writeFileSync(path.join(coreMiddlewaresRoot, `_helper.js`), "'use strict'; module.exports = () => 'helper';\n");
  fs.writeFileSync(path.join(coreMiddlewaresRoot, `core-beta.js`), "'use strict'; module.exports = () => 'beta';\n");
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
    coreMiddlewaresPath: coreMiddlewaresRoot,
    tenantMiddlewarePaths: {
      http: tenantHttpRoot,
      ws: tenantWsRoot
    }
  });

  await resolver.initialize();

  assert.deepEqual(resolver.getCoreMiddlewareOrder(), [`core-alpha`, `core-beta`]);
  assert.deepEqual(Object.keys(resolver.getCoreMiddlewares()), [`core-alpha`, `core-beta`]);
  assert.deepEqual(Object.keys(resolver.getTenantMiddlewares().http), [`tenant-http`]);
  assert.deepEqual(Object.keys(resolver.getTenantMiddlewares().ws), [`tenant-ws`]);
});

test(`middleware-stack-resolver lazily loads and caches app registries for the current tenant`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-middleware-stack-app-`));
  const tenantsBase = path.join(tempRoot, `tenants`);
  const tenantRoot = path.join(tenantsBase, `tenant_aaaaaaaaaaaa`);
  const appRoot = path.join(tenantRoot, `app_bbbbbbbbbbbb`);
  const appHttpRoot = path.join(appRoot, `app`, `http`, `middlewares`);
  const appWsRoot = path.join(appRoot, `app`, `ws`, `middlewares`);

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
  fs.writeFileSync(path.join(appHttpRoot, `auth.js`), "'use strict'; module.exports = () => 'auth';\n");
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
  const secondLoad = await resolver.loadAppMiddlewares(`bbbbbbbbbbbb`);

  assert.equal(firstLoad, secondLoad);
  assert.deepEqual(Object.keys(firstLoad.http), [`auth`]);
  assert.deepEqual(Object.keys(firstLoad.ws), [`socket-auth`]);
  assert.equal(resolver.getAppMiddlewares(`bbbbbbbbbbbb`), firstLoad);
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
