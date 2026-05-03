'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const PluginOrchestrator = require(`@/_core/orchestrators/plugin-orchestrator`);
const { createPluginContextFactory, MainPluginContextV1 } = require(`@/_core/boot/plugin-context-contracts`);
const ObservabilitySurface = require(`@/builtin-extensions/plugins/ObservabilitySurface`);

test(`plugin register remains compatible when no context contract is declared`, async () => {
  const executor = new PluginOrchestrator(`main`, {});
  executor.activateContext(`MAIN`);
  let receivedArgs = 0;

  await executor.registerPlugin({
    name: `legacy-plugin`,
    async register(...args) {
      receivedArgs = args.length;
    }
  });

  assert.equal(receivedArgs, 1);
});

test(`plugin receives a validated main.v1 context when declared`, async () => {
  const executor = new PluginOrchestrator(`main`, {});
  executor.activateContext(`MAIN`);
  const kernelContext = {
    useCases: {
      rpcRouter: {
        endpoint: {
          addListener() {},
          removeListener() {}
        }
      },
      processForkRuntime: {
        listProcesses() { return []; },
        getProcessCountsSnapshot() { return { total: 0 }; },
        getLifecycleHistory() { return []; }
      },
      watchdogOrchestrator: {
        getProcessHealth() { return null; }
      }
    }
  };
  const createPluginContext = createPluginContextFactory({
    kernelContext,
    contextName: `MAIN`,
    processLabel: `main`
  });
  let receivedContext = null;

  await executor.registerPlugin({
    name: `contract-plugin`,
    contextContracts: { MAIN: `main.v1` },
    async register(_executor, pluginContext) {
      receivedContext = pluginContext;
    }
  }, { createPluginContext });

  assert.equal(receivedContext instanceof MainPluginContextV1, true);
  assert.equal(receivedContext.contractId, `main.v1`);
  assert.equal(Object.isFrozen(receivedContext), true);
});

test(`plugin context contract errors name plugin, context, and missing contract`, async () => {
  const executor = new PluginOrchestrator(`main`, {});
  executor.activateContext(`MAIN`);
  const createPluginContext = createPluginContextFactory({
    kernelContext: { useCases: {} },
    contextName: `MAIN`,
    processLabel: `main`
  });

  await assert.rejects(
    () => executor.registerPlugin({
      name: `broken-plugin`,
      contextContracts: { MAIN: `missing.v1` },
      async register() {}
    }, { createPluginContext }),
    /broken-plugin.*missing\.v1.*MAIN/
  );
});

test(`ObservabilitySurface authorizes only configured app rpc identities`, async () => {
  const listeners = new Map();
  const executor = new PluginOrchestrator(`main`, {
    ObservabilitySurface: {
      allowedApps: [
        { tenantId: `tenant_a`, appId: `app_dash` }
      ],
      questions: {
        snapshot: `custom.snapshot`
      }
    }
  });
  executor.activateContext(`MAIN`);

  const kernelContext = {
    useCases: {
      rpcRouter: {
        endpoint: {
          addListener(question, handler) {
            listeners.set(question, handler);
          },
          removeListener(question) {
            listeners.delete(question);
          }
        }
      },
      processForkRuntime: {
        listProcesses() { return [{ label: `director`, pid: 123, state: `ready` }]; },
        getProcessCountsSnapshot() { return { total: 1, director: 1 }; },
        getLifecycleHistory() { return [{ type: `launch`, label: `director` }]; }
      },
      watchdogOrchestrator: {
        heartbeatHealthByLabel: new Map([[`director`, { healthy: true }]]),
        getProcessHealth(label) {
          return this.heartbeatHealthByLabel.get(label) ?? null;
        }
      }
    }
  };
  const createPluginContext = createPluginContextFactory({
    kernelContext,
    contextName: `MAIN`,
    processLabel: `main`
  });

  await executor.registerPlugin(ObservabilitySurface, { createPluginContext });
  await executor.run(executor.hooks.MAIN.PROCESS.READY);

  const handler = listeners.get(`custom.snapshot`);
  assert.equal(typeof handler, `function`);

  const allowed = handler({
    internalMeta: {
      appRpcContext: {
        tenantId: `tenant_a`,
        appId: `app_dash`
      }
    }
  });
  assert.equal(allowed.success, true);
  assert.equal(allowed.data.counts.total, 1);

  const denied = handler({
    tenantId: `tenant_a`,
    appId: `app_dash`,
    internalMeta: {
      appRpcContext: {
        tenantId: `tenant_a`,
        appId: `other_app`
      }
    }
  });
  assert.equal(denied.success, false);
  assert.equal(denied.code, `OBSERVABILITY_FORBIDDEN`);
});
