// test/shared-cache-failure-policy.test.js

'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const SharedCacheService = require(`@/_core/services/shared-cache-service`);
const sessionRuntimePlugin = require(`@plugin/session-runtime`);

const { persistSessionData } = sessionRuntimePlugin._internal;

function createPluginHooks() {
  return {
    SHARED: {
      SHARED_CACHE: { BEFORE: 1, AFTER: 2, ERROR: 3 }
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
      adapters: {
        sharedCacheService: {
          adapter: `custom`,
          enabled: true,
          defaultTTL: 3600,
          failurePolicy
        }
      }
    },
    pluginOrchestrator: {
      hooks: createPluginHooks(),
      async run() {}
    },
    useCases: {}
  });
}

function createThrowingAdapter({
  throwGet = true,
  throwSet = true
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-shared-cache-failure-`));
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

test(`session runtime treats fail-open false cache set result as persistence failure`, async () => {
  await assert.rejects(
    () => persistSessionData({
      cacheService: {
        async set() {
          return false;
        }
      },
      host: `www.fakedomain.com`,
      cookie: {},
      sessionData: { userId: 1 },
      cacheTTL: 3600000
    }),
    /Failed to persist session data/
  );
});
