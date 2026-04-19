// bootstrap/process-director.js


'use strict';


require(`module-alias/register`);
const { setHeartbeatCallback } = require(`@/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);
const { applyConfiguredNoSpawnFilter } = require(`@/utils/process/seccomp`);
const configLoad = require(`@/config/default.user.config`);
const kernelDirector = require(`@/_core/kernel/kernel-director`);
const BootResolver = require(`@/_core/boot/boot-resolver`);
const clearRequireCache = require(`@/utils/module/clear-require-cache`);
const { startDirectorCliSocketServer } = require(`./director-cli-socket`);

boot();

/**
 * Boots the director child process and wires tenancy
 * and queue RPC services.
 */
async function boot() {
  applyProcessIdentityFromEnv();
  await ensureBootstrapCapabilitiesSanitized({
    dropIfAnyCapabilities: true
  });
  applyConfiguredNoSpawnFilter({
    processLabel: process.env.PROCESS_LABEL ?? `director`
  });

  // CONFIG LOAD
  const config = await configLoad();

  const processLabel = process.env.PROCESS_LABEL ?? `director`;
  const useCasesDirector = await kernelDirector({ config, processLabel });
  const plugin = useCasesDirector.pluginOrchestrator;
  const { hooks } = plugin;

  BootResolver.setupExitHandlers(plugin, hooks.DIRECTOR.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.DIRECTOR.PROCESS.SPAWN, null, hooks.DIRECTOR.PROCESS.ERROR);

  /* HOOK >> */ await plugin.run(hooks.DIRECTOR.PROCESS.BOOTSTRAP, {
    message: `BOOTSTRAP: DIRECTOR`,
    source: `process-director`,
    stage: `kernel-ready`,
    data: {
      node: process.version,
      pid: process.pid
    }
  }, hooks.DIRECTOR.PROCESS.ERROR);

  //SETUP ENDPOINT
  const { rpcEndpoint } = useCasesDirector;
  BootResolver.registerStateReporter(async (state, data = {}) => {
    await rpcEndpoint.ask({
      target: `main`,
      question: `state`,
      data: { state, ...data }
    });
  });

  console.log(`Enabling director heartbeat reporting`);
  setHeartbeatCallback((data) => {
    rpcEndpoint.ask({
      target: `main`,
      question: config.adapters.watchdogOrchestrator?.question?.heartbeat ?? `heartbeat`,
      data
    }).catch(() => { });
  }, { processLabel: process.env.PROCESS_LABEL ?? `director` });

  {
    const { webServerService } = useCasesDirector;
    console.log(`Waiting for web server service readiness`);
    webServerService.setupServer().then(() => {

    }).catch((e) => {

    });
  }

  {
    // TENANCY ROUTING
    const { tenantDirectoryResolver, requestUriRoutingRuntime } = useCasesDirector;
    const nQ = config.adapters.ingressRuntime.question;
    const tQ = config.adapters.tenantDirectoryResolver.question;
    const pQ = config.adapters.processForkRuntime.question;
    console.log(`Registering tenancy routing RPC handlers`);
    rpcEndpoint.addListener(nQ.requestUriRoutingRuntime, (i) => requestUriRoutingRuntime.matchRoute(i));
    rpcEndpoint.addListener(tQ.forceRescanNow, (i) => tenantDirectoryResolver.requestForcedScan({
      reason: i?.reason ?? `rpc_force_rescan`
    }));
    rpcEndpoint.addListener(tQ.shutdownProcessNow, async (i) => {
      const label = i?.label ?? null;
      if (!label) {
        return {
          success: false,
          skipped: true,
          reason: `missing_label`
        };
      }

      return rpcEndpoint.ask({
        target: `main`,
        question: pQ.shutdownProcess ?? `shutdownProcess`,
        data: {
          label,
          reason: i?.reason ?? `director_requested_shutdown`,
          timeoutMs: i?.timeoutMs ?? null
        }
      });
    });

    console.log(`Starting director CLI RPC socket`);
    const directorCliSocketServer = await startDirectorCliSocketServer({
      rpcEndpoint,
      config
    });
    process.on(`exit`, () => {
      directorCliSocketServer.close().catch(() => { });
    });

    console.log(`Loading tenancy route definitions`);
    await tenantDirectoryResolver.scan();

    const tenancyReadiness = tenantDirectoryResolver.getReadinessSnapshot();
    if (!tenancyReadiness.ready) {
      throw new Error(`Director tenant directory resolver is not ready after initial scan`);
    }

    // rpcEndpoint.addListener(nQ.getSharedObject, .getSharedObject);
    // rpcEndpoint.addListener(nQ.setSharedObject, .setSharedObject);
  }

  {
    // SHARED QUEUE BROKER
    const { queueBroker } = useCasesDirector;

    // REGISTER MIDDLEWARE STACK ANSWERS
    const mQ = config.adapters.middlewareStackRuntime.question;
    console.log(`Registering shared queue RPC handlers`);
    rpcEndpoint.addListener(mQ.enqueue, (i, delayedResolve) => queueBroker.appendToQueue(i, delayedResolve));
    rpcEndpoint.addListener(mQ.dequeue, (i) => queueBroker.removeFromQueue(i));
    rpcEndpoint.addListener(mQ.cleanupByOrigin, (i) => queueBroker.removeTasksByOrigin(i));
  }

  console.log(`Notifying main process that director is ready`);
  rpcEndpoint.ask({
    target: `main`,
    question: `state`,
    data: {
      state: `ready`
    }
  }).catch(() => { });

  /* HOOK >> */ await plugin.run(hooks.DIRECTOR.PROCESS.READY, null, hooks.DIRECTOR.PROCESS.ERROR);
  clearRequireCache();
}
