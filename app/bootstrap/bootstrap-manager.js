// bootstrap/bootstrap-manager.js


'use strict';


require(`module-alias/register`);
const path = require(`path`);
const { resolveProcessUser, resolveProcessGroup } = require(`@/config/runtime-policy`);

boot();

/**
 * Boots the manager child process and wires tenancy
 * and queue RPC services.
 */
async function boot() {
  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  // PLUGIN EXECUTOR
  const PluginExecutor = require(`@/_core/boot/plugin-executor`);
  const processLabel = process.env.PROCESS_LABEL ?? `manager`;
  const plugin = new PluginExecutor(processLabel, config.plugins);
  const { hooks } = plugin;
  await plugin.scanPlugins(`MANAGER`, config.app.customPluginsPath, config.plugins)
    .catch((error) => { throw error });

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.MANAGER.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.MANAGER.PROCESS.SPAWN, null, hooks.MANAGER.PROCESS.ERROR);

  const gatewaysManager = require(`@/_core/kernel/kernel-manager`)({ config, plugin });

  /* HOOK >> */ await plugin.run(hooks.MANAGER.PROCESS.BOOTSTRAP, null, hooks.MANAGER.PROCESS.ERROR);

  const startup = require(`@/utils/logger/logger-startup`);
  await startup.stepWrap(`BOOTSTRAP: MANAGER`, async () => {

    // drop user privileges
    if (process.getuid && process.getuid() === 0) {
      const processLabel = process.env.PROCESS_LABEL ?? `manager`;
      const processUser = process.env.PROCESS_USER ?? resolveProcessUser(processLabel);
      const processGroup = process.env.PROCESS_GROUP ?? resolveProcessGroup(processLabel, processUser);
      startup.startupInfoLog(`Switching manager process privileges to ${processUser}:${processGroup}`);
      process.setgid(processGroup); process.setuid(processUser);
    }

    //SETUP ENDPOINT
    const { rpcEndpoint } = gatewaysManager;
    BootResolver.registerStateReporter(async (state, data = {}) => {
      await rpcEndpoint.ask({
        target: `main`,
        question: `state`,
        data: { state, ...data }
      });
    });

    const heartbeatHealth = require(path.join(__dirname, `..`, `utils`, `heartbeat-health.js`));
    startup.startupInfoLog(`Enabling manager heartbeat reporting`);
    heartbeatHealth.setHeartbeatCallback((data) => {
      rpcEndpoint.ask({
        target: `main`,
        question: `heartbeat`,
        data
      }).catch(() => { });
    }, { processLabel: process.env.PROCESS_LABEL ?? `manager` });

    {
      // TENANCY ROUTING
      const { tenancyRouter } = gatewaysManager;
      const nQ = config.networkEngine.question;
      startup.startupInfoLog(`Registering tenancy routing RPC handlers`);
      rpcEndpoint.addListener(nQ.tenancyRouter, (i) => tenancyRouter.matchRoute(i));

      startup.startupInfoLog(`Loading tenancy route definitions`);
      await tenancyRouter.scan();

      const tenancyReadiness = tenancyRouter.getReadinessSnapshot();
      if (!tenancyReadiness.ready) {
        throw new Error(`Manager tenancy router is not ready after initial scan`);
      }

      // rpcEndpoint.addListener(nQ.getSharedObject, .getSharedObject);
      // rpcEndpoint.addListener(nQ.setSharedObject, .setSharedObject);
    }

    {
      // SHARED QUEUE BROKER
      const { queueBroker } = gatewaysManager;

      //REGISTER PIPELINE ANSWERS
      const pQ = config.requestPipeline.question;
      startup.startupInfoLog(`Registering shared queue RPC handlers`);
      rpcEndpoint.addListener(pQ.enqueue, (i, delayedResolve) => queueBroker.appendToQueue(i, delayedResolve));
      rpcEndpoint.addListener(pQ.dequeue, (i) => queueBroker.removeFromQueue(i));
      rpcEndpoint.addListener(pQ.cleanupByOrigin, (i) => queueBroker.removeTasksByOrigin(i));
    }

    startup.startupInfoLog(`Notifying main process that manager is ready`);
    rpcEndpoint.ask({
      target: `main`,
      question: `state`,
      data: {
        state: `ready`
      }
    }).catch(() => { });
  });

  /* HOOK >> */ await plugin.run(hooks.MANAGER.PROCESS.READY, null, hooks.MANAGER.PROCESS.ERROR);
}
