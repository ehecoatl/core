'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const weakRequire = require(`@/utils/module/weak-require`);
const clearRequireCache = require(`@/utils/module/clear-require-cache`);

test.afterEach(() => {
  weakRequire.clearAll();
});

test(`clearRequireCache removes loaded modules from require.cache by default`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-clear-require-cache-`));
  const modulePath = path.join(tempRoot, `target.js`);
  fs.writeFileSync(modulePath, `module.exports = { value: 'cached' };\n`, `utf8`);

  try {
    const resolvedPath = require.resolve(modulePath);
    require(modulePath);
    assert.ok(require.cache[resolvedPath]);

    const result = clearRequireCache();

    assert.ok(result.clearedCount >= 1);
    assert.equal(result.preservedCount, 0);
    assert.equal(require.cache[resolvedPath], undefined);
  } finally {
    weakRequire.clear(modulePath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`clearRequireCache preserves explicit modules when requested`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-clear-require-cache-preserve-`));
  const modulePath = path.join(tempRoot, `target.js`);
  fs.writeFileSync(modulePath, `module.exports = { value: 'preserved' };\n`, `utf8`);

  try {
    const resolvedPath = require.resolve(modulePath);
    require(modulePath);
    assert.ok(require.cache[resolvedPath]);

    const result = clearRequireCache({
      preserve: [modulePath]
    });

    assert.equal(result.preservedCount, 1);
    assert.ok(require.cache[resolvedPath]);
  } finally {
    weakRequire.clear(modulePath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`clearRequireCache also clears weakRequire tracked modules`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-clear-require-cache-weak-`));
  const modulePath = path.join(tempRoot, `target.js`);
  fs.writeFileSync(modulePath, `module.exports = { value: 'first' };\n`, `utf8`);

  try {
    const resolvedPath = require.resolve(modulePath);
    const firstLoad = weakRequire(modulePath);
    assert.ok(require.cache[resolvedPath]);

    clearRequireCache();

    assert.equal(require.cache[resolvedPath], undefined);

    fs.writeFileSync(modulePath, `module.exports = { value: 'second' };\n`, `utf8`);
    const secondLoad = weakRequire(modulePath);
    assert.equal(secondLoad.value, `second`);
    assert.notEqual(firstLoad, secondLoad);
  } finally {
    weakRequire.clear(modulePath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
