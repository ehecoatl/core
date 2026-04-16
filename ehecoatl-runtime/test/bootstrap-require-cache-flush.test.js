'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const path = require(`node:path`);

test(`bootstrap-main flushes require cache once after the READY hook`, () => {
  const source = readBootstrapSource(`bootstrap-main.js`);

  assert.equal(countOccurrences(source, `clearRequireCache()`), 1);
  assert.ok(
    source.indexOf(`await plugin.run(hooks.MAIN.PROCESS.READY, null, hooks.MAIN.PROCESS.ERROR);`)
    < source.indexOf(`clearRequireCache();`)
  );
});

test(`bootstrap-director flushes require cache once after readiness is reported`, () => {
  const source = readBootstrapSource(`bootstrap-director.js`);

  assert.equal(countOccurrences(source, `clearRequireCache()`), 1);
  assert.ok(source.indexOf(`state: \`ready\``) < source.indexOf(`clearRequireCache();`));
  assert.ok(
    source.indexOf(`await plugin.run(hooks.DIRECTOR.PROCESS.READY, null, hooks.DIRECTOR.PROCESS.ERROR);`)
    < source.indexOf(`clearRequireCache();`)
  );
});

test(`bootstrap-transport flushes require cache once after readiness is reported`, () => {
  const source = readBootstrapSource(`bootstrap-transport.js`);

  assert.equal(countOccurrences(source, `clearRequireCache()`), 1);
  assert.equal(countOccurrences(source, `finalizeRuntimeIsolation()`), 1);
  assert.ok(source.indexOf(`state: \`ready\``) < source.indexOf(`clearRequireCache();`));
  assert.ok(
    source.indexOf(`await plugin.run(hooks.TRANSPORT.PROCESS.READY, null, hooks.TRANSPORT.PROCESS.ERROR);`)
    < source.indexOf(`clearRequireCache();`)
  );
  assert.ok(source.indexOf(`clearRequireCache();`) < source.indexOf(`finalizeRuntimeIsolation();`));
});

test(`bootstrap-isolated-runtime flushes require cache once before weak-loading the app entrypoint and action handlers`, () => {
  const source = readBootstrapSource(`bootstrap-isolated-runtime.js`);

  assert.equal(countOccurrences(source, `clearRequireCache()`), 1);
  assert.equal(countOccurrences(source, `finalizeRuntimeIsolation()`), 1);
  assert.ok(source.indexOf(`clearRequireCache();`) < source.indexOf(`await bootIsolatedAppEntrypoint({`));
  assert.ok(source.indexOf(`clearRequireCache();`) < source.indexOf(`finalizeRuntimeIsolation();`));
  assert.ok(source.indexOf(`finalizeRuntimeIsolation();`) < source.indexOf(`await bootIsolatedAppEntrypoint({`));
  assert.ok(source.indexOf(`clearRequireCache();`) < source.indexOf(`rpcEndpoint.addListener(tenantActionQuestion`));
  assert.ok(source.indexOf(`clearRequireCache();`) < source.indexOf(`rpcEndpoint.addListener(tenantWsActionQuestion`));
  assert.ok(
    source.indexOf(`const isolatedEntrypoint = weakRequire(entryPath);`) > source.indexOf(`clearRequireCache();`)
  );
  assert.ok(
    source.indexOf(`const isolatedEntrypoint = weakRequire(entryPath);`) > source.indexOf(`finalizeRuntimeIsolation();`)
  );
});

function readBootstrapSource(fileName) {
  return fs.readFileSync(path.join(__dirname, `..`, `bootstrap`, fileName), `utf8`);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}
