'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const internalScopeContract = require(`@/contracts/layers/internal-scope.contract.js`);
const { deriveSetupTopology } = require(`@/contracts/derive-setup-topology.js`);

test(`internal-scope contract exposes packaged middleware subtree as shared read-only install paths`, () => {
  assert.deepEqual(internalScopeContract.PATHS.INTERNAL.extensions, [
    `/opt/ehecoatl/extensions`,
    null,
    null,
    `0555`
  ]);
  assert.deepEqual(internalScopeContract.PATHS.INTERNAL.sharedMiddlewares, [
    `/opt/ehecoatl/extensions/middlewares`,
    null,
    null,
    `0555`
  ]);
  assert.deepEqual(internalScopeContract.PATHS.INTERNAL.sharedHttpMiddlewares, [
    `/opt/ehecoatl/extensions/middlewares/http`,
    null,
    null,
    `0555`
  ]);
  assert.deepEqual(internalScopeContract.PATHS.INTERNAL.sharedWsMiddlewares, [
    `/opt/ehecoatl/extensions/middlewares/ws`,
    null,
    null,
    `0555`
  ]);
});

test(`deriveSetupTopology includes packaged middleware subtree with shared read-only modes`, () => {
  const topology = deriveSetupTopology();
  const byPath = new Map(topology.map((entry) => [entry.path, entry]));

  assert.equal(byPath.get(`/opt/ehecoatl/extensions`)?.mode, `0555`);
  assert.equal(byPath.get(`/opt/ehecoatl/extensions/middlewares`)?.mode, `0555`);
  assert.equal(byPath.get(`/opt/ehecoatl/extensions/middlewares/http`)?.mode, `0555`);
  assert.equal(byPath.get(`/opt/ehecoatl/extensions/middlewares/ws`)?.mode, `0555`);
  assert.equal(byPath.get(`/opt/ehecoatl/extensions/middlewares/http`)?.recursive, true);
  assert.equal(byPath.get(`/opt/ehecoatl/extensions/middlewares/ws`)?.recursive, true);
});

test(`deriveSetupTopology leaves recursive undefined when it is not declared`, () => {
  const originalDefaultsRecursive = internalScopeContract.PATH_DEFAULTS.recursive;
  const originalDebugPaths = internalScopeContract.PATHS.DEBUG;

  try {
    internalScopeContract.PATH_DEFAULTS.recursive = undefined;
    internalScopeContract.PATHS.DEBUG = {
      nonRecursiveProbe: [`/opt/ehecoatl/.recursive-probe`, null, null, `0555`]
    };

    const topology = deriveSetupTopology();
    const probeEntry = topology.find((entry) => entry.path === `/opt/ehecoatl/.recursive-probe`);
    assert.equal(probeEntry?.recursive, undefined);
  } finally {
    internalScopeContract.PATH_DEFAULTS.recursive = originalDefaultsRecursive;
    if (originalDebugPaths === undefined) {
      delete internalScopeContract.PATHS.DEBUG;
    } else {
      internalScopeContract.PATHS.DEBUG = originalDebugPaths;
    }
  }
});
