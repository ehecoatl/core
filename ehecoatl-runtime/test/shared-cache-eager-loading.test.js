'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const SharedCacheService = require(`@/_core/services/shared-cache-service`);

test(`SharedCacheService loads its adapter during construction and serves requests without reloading`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-shared-cache-eager-`));
  const adapterPath = path.join(tempRoot, `mock-shared-cache-adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `let connected = 0;`,
    `module.exports = {`,
    `  marker: 'shared-cache-eager',`,
    `  async connectAdapter() {`,
    `    connected += 1;`,
    `  },`,
    `  async getAdapter({ key, defaultValue }) {`,
    `    return key === 'present' ? 'cached-value' : defaultValue;`,
    `  },`,
    `  getConnectedCount() {`,
    `    return connected;`,
    `  }`,
    `};`
  ].join(`\n`), `utf8`);

  const kernelContext = {
    config: {
      _adapters: {
        sharedCacheService: adapterPath
      },
      adapters: {
        sharedCacheService: {
          failurePolicy: {}
        }
      }
    },
    pluginOrchestrator: {
      hooks: {
        SHARED: {
          SHARED_CACHE: {
            BEFORE: null,
            AFTER: null,
            ERROR: null
          }
        }
      },
      async run() {
      }
    }
  };

  const sharedCacheService = new SharedCacheService(kernelContext);

  assert.equal(sharedCacheService.adapter?.marker, `shared-cache-eager`);
  assert.equal(await sharedCacheService.get(`present`, `fallback`), `cached-value`);
  assert.equal(await sharedCacheService.get(`missing`, `fallback`), `fallback`);
  assert.equal(sharedCacheService.adapter?.getConnectedCount?.(), 1);
});
