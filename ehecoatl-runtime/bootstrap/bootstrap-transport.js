// bootstrap/bootstrap-transport.js


'use strict';


require(`module-alias/register`);
const { setHeartbeatCallback } = require(`@/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);

boot();

async function boot() {
  applyProcessIdentityFromEnv();
  await ensureBootstrapCapabilitiesSanitized({
    dropIfAnyCapabilities: true
  });

  const config = await require(`@/config/default.user.config`)();
  const deepMerge = require(`@/utils/deep-merge`);

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
  const useCasesTransport = await require(`@/_core/kernel/kernel-transport`)({
    config: effectiveConfig,
    processLabel,
    tenantId
  });
  const plugin = useCasesTransport.pluginOrchestrator;
  const { hooks } = plugin;

  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.TRANSPORT.PROCESS);

  await plugin.run(hooks.TRANSPORT.PROCESS.SPAWN, null, hooks.TRANSPORT.PROCESS.ERROR);

  await plugin.run(hooks.TRANSPORT.PROCESS.BOOTSTRAP, null, hooks.TRANSPORT.PROCESS.ERROR);

  console.log(`BOOTSTRAP: TRANSPORT`);

  //INGRESS RUNTIME
  console.log(`Waiting for ingress runtime readiness`);
  await useCasesTransport.ingressRuntime.startupPromise;

  const { rpcEndpoint } = useCasesTransport;
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
}
