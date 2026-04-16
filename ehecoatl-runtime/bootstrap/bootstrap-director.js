// bootstrap/bootstrap-director.js


'use strict';


require(`module-alias/register`);
const { setHeartbeatCallback } = require(`@/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);

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

  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  const processLabel = process.env.PROCESS_LABEL ?? `director`;
  const useCasesDirector = await require(`@/_core/kernel/kernel-director`)({ config, processLabel });
  const plugin = useCasesDirector.pluginOrchestrator;
  const { hooks } = plugin;

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.DIRECTOR.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.DIRECTOR.PROCESS.SPAWN, null, hooks.DIRECTOR.PROCESS.ERROR);

  /* HOOK >> */ await plugin.run(hooks.DIRECTOR.PROCESS.BOOTSTRAP, null, hooks.DIRECTOR.PROCESS.ERROR);

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
    const { tenantDirectoryResolver, requestUriRouteResolver } = useCasesDirector;
    const nQ = config.adapters.ingressRuntime.question;
    console.log(`Registering tenancy routing RPC handlers`);
    rpcEndpoint.addListener(nQ.requestUriRouteResolver, (i) => requestUriRouteResolver.matchRoute(i));

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
    const pQ = config.adapters.middlewareStackOrchestrator.question;
    console.log(`Registering shared queue RPC handlers`);
    rpcEndpoint.addListener(pQ.enqueue, (i, delayedResolve) => queueBroker.appendToQueue(i, delayedResolve));
    rpcEndpoint.addListener(pQ.dequeue, (i) => queueBroker.removeFromQueue(i));
    rpcEndpoint.addListener(pQ.cleanupByOrigin, (i) => queueBroker.removeTasksByOrigin(i));
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
}
