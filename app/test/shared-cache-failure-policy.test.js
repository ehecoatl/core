// test/shared-cache-failure-policy.test.js

'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);
const SessionRouter = require(`g@/engine/session-router/session-router`);

function createPluginHooks() {
  return {
    SHARED: {
      SHARED_CACHE: { BEFORE: 1, AFTER: 2, ERROR: 3 }
    },
    ENGINE: {
      SESSION: {
        AUTH_CSRF: { BEFORE: 10, AFTER: 11, ERROR: 12 },
        GET_SESSION: { BEFORE: 13, AFTER: 14, ERROR: 15 },
        UPDATE_COOKIE: { BEFORE: 16, AFTER: 17, ERROR: 18 },
        UPDATE_SESSION: { BEFORE: 19, AFTER: 20, ERROR: 21 },
        CACHE_SET: { BEFORE: 22, AFTER: 23, ERROR: 24 },
        CACHE_GET: { BEFORE: 25, AFTER: 26, ERROR: 27 },
        CREATE: { BEFORE: 28, AFTER: 29, ERROR: 30 }
      }
    }
  };
}

function createSharedCacheService({
  adapterPath,
  failurePolicy = undefined
}) {
  return new SharedCacheService({
    config: {
      _adapters: {
        sharedCacheService: adapterPath
      },
      sharedCacheService: {
        adapter: `custom`,
        enabled: true,
        defaultTTL: 3600,
        failurePolicy
      }
    },
    plugin: {
      hooks: createPluginHooks(),
      async run() {}
    },
    gateways: {}
  });
}

function createThrowingAdapter({
  throwGet = true,
  throwSet = true
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-shared-cache-failure-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  async connectAdapter() {},`,
    `  async getAdapter() { ${throwGet ? `throw new Error('get failed');` : `return 'ok';`} },`,
    `  async setAdapter() { ${throwSet ? `throw new Error('set failed');` : `return true;`} },`,
    `  async deleteAdapter() { return true; },`,
    `  async deleteByPrefixAdapter() { return 0; },`,
    `  async hasAdapter() { return false; },`,
    `  async appendListAdapter() { return true; },`,
    `  async getListAdapter() { return []; },`,
    `  async quitAdapter() {},`,
    `};`
  ].join(`\n`));
  return { tempDir, adapterPath };
}

test(`shared cache get failures are fail-open and logged as warnings`, async () => {
  const { tempDir, adapterPath } = createThrowingAdapter({ throwGet: true, throwSet: false });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(` `));

  try {
    const cache = createSharedCacheService({ adapterPath });
    const value = await cache.get(`tenant:test:key`, `fallback`);
    assert.equal(value, `fallback`);
    assert.ok(warnings.some((line) => line.includes(`[shared_cache_warning]`) && line.includes(`operation=get`)));
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`shared cache set failures are fail-open and logged as warnings`, async () => {
  const { tempDir, adapterPath } = createThrowingAdapter({ throwGet: false, throwSet: true });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(` `));

  try {
    const cache = createSharedCacheService({ adapterPath });
    const ok = await cache.set(`tenant:test:key`, `value`, 1000);
    assert.equal(ok, false);
    assert.ok(warnings.some((line) => line.includes(`[shared_cache_warning]`) && line.includes(`operation=set`)));
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`session router treats fail-open false cache set result as persistence failure`, async () => {
  const sessionRouter = new SessionRouter({
    config: {
      _adapters: {
        sessionRouter: require.resolve(`@/adapters/engine/session-router/default-session`)
      },
      sessionRouter: {
        cacheTTL: 3600000
      }
    },
    plugin: {
      hooks: createPluginHooks(),
      async run() {}
    },
    gateways: {
      sharedCacheService: {
        async get() {
          return null;
        },
        async set() {
          return false;
        }
      }
    }
  });

  await assert.rejects(
    () => sessionRouter.setSessionData({
      tenantRoute: { host: `www.fakedomain.com`, session: true },
      cookie: {},
      sessionData: { userId: 1 }
    }),
    /Failed to persist session data/
  );
});
