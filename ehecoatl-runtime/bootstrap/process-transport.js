// bootstrap/process-transport.js


'use strict';


require(`module-alias/register`);
const { setHeartbeatCallback } = require(`@/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);
const { applyConfiguredNoSpawnFilter } = require(`@/utils/process/seccomp`);
const configLoad = require(`@/config/default.user.config`);
const deepMerge = require(`@/utils/deep-merge`);
const kernelTransport = require(`@/_core/kernel/kernel-transport`);
const BootResolver = require(`@/_core/boot/boot-resolver`);
const clearRequireCache = require(`@/utils/module/clear-require-cache`);
const { finalizeRuntimeIsolation } = require(`@/utils/process/finalize-runtime-isolation`);
const bootLogger = require(`@plugin/boot-logger`);

boot();

async function boot() {
  applyProcessIdentityFromEnv();
  await ensureBootstrapCapabilitiesSanitized({
    dropIfAnyCapabilities: true
  });
  applyConfiguredNoSpawnFilter({
    processLabel: process.env.PROCESS_LABEL ?? `transport`
  });

  const config = await configLoad();

  const processLabel = process.env.PROCESS_LABEL ?? `transport`;
  const tenantId = process.argv[2] ?? null;
  const tenantDomain = process.argv[3] ?? null;
  const tenantRoot = process.argv[4] ?? null;
  const httpPort = Number(process.argv[5] ?? NaN);
  const wsPort = Number(process.argv[6] ?? NaN);
  const effectiveConfig = Number.isInteger(httpPort) && Number.isInteger(wsPort)
    ? deepMerge(config, {
      adapters: {
        ingressRuntime: {
          httpCoreIngressPort: httpPort,
          wsCoreIngressPort: wsPort
        }
      }
    })
    : config;
  const useCasesTransport = await kernelTransport({
    config: effectiveConfig,
    processLabel,
    tenantId,
    tenantDomain
  });
  const plugin = useCasesTransport.pluginOrchestrator;
  const { hooks } = plugin;

  BootResolver.setupExitHandlers(plugin, hooks.TRANSPORT.PROCESS);

  await plugin.run(hooks.TRANSPORT.PROCESS.SPAWN, null, hooks.TRANSPORT.PROCESS.ERROR);

  const { rpcEndpoint, wsHubManager } = useCasesTransport;
  await plugin.run(hooks.TRANSPORT.PROCESS.BOOTSTRAP, {
    message: `BOOTSTRAP: TRANSPORT`,
    source: `process-transport`,
    stage: `kernel-ready`,
    data: {
      node: process.version,
      pid: process.pid,
      tenantId,
      tenantDomain,
      tenantRoot,
      httpPort: Number.isInteger(httpPort) ? httpPort : null,
      wsPort: Number.isInteger(wsPort) ? wsPort : null
    },
    forwardBootLogLines: createBootLogForwarder(rpcEndpoint)
  }, hooks.TRANSPORT.PROCESS.ERROR);

  const wsHubQuestion = effectiveConfig.adapters.wsHubManager?.question?.command ?? `wsHub`;
  rpcEndpoint.addListener(wsHubQuestion, async ({ command, ...data }, resolve) => {
    resolve(await wsHubManager.handleCommand({
      command,
      ...data
    }));
    return false;
  });

  //INGRESS RUNTIME
  console.log(`Waiting for ingress runtime readiness`);
  await useCasesTransport.ingressRuntime.startupPromise;
  BootResolver.registerStateReporter(async (state, data = {}) => {
    await rpcEndpoint.ask({
      target: `main`,
      question: `state`,
      data: { state, ...data }
    });
  });

  console.log(`Enabling transport heartbeat reporting`);
  setHeartbeatCallback((data) => {
    rpcEndpoint.ask({
      target: `main`,
      question: config.adapters.watchdogOrchestrator?.question?.heartbeat ?? `heartbeat`,
      data
    }).catch(() => { });
  }, {
    processLabel: process.env.PROCESS_LABEL ?? `transport`,
    tenantId,
    tenantDomain,
    tenantRoot,
    httpPort: Number.isInteger(httpPort) ? httpPort : null,
    wsPort: Number.isInteger(wsPort) ? wsPort : null
  });

  console.log(`Notifying main process that transport is ready`);
  rpcEndpoint.ask({
    target: `main`,
    question: `state`,
    data: {
      state: `ready`
    }
  }).catch(() => { });

  await plugin.run(hooks.TRANSPORT.PROCESS.READY, null, hooks.TRANSPORT.PROCESS.ERROR);
  clearRequireCache();
  finalizeRuntimeIsolation();
}

function createBootLogForwarder(rpcEndpoint) {
  return async (lines) => {
    await rpcEndpoint.ask({
      target: `main`,
      question: bootLogger.BOOT_LOG_WRITE_QUESTION,
      data: { lines }
    });
  };
}
