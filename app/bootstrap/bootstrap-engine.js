// bootstrap/bootstrap-engine.js


'use strict';


require(`module-alias/register`);
const path = require(`path`);
const { resolveProcessUser, resolveProcessGroup } = require(`@/config/runtime-policy`);

boot();

/**
 * Boots one engine child process and exposes the network 
 * entrypoint and request pipeline runtime.
 */
async function boot() {
  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  // PLUGIN EXECUTOR
  const PluginExecutor = require(`@/_core/boot/plugin-executor`);
  const processLabel = process.env.PROCESS_LABEL ?? `engine`;
  const plugin = new PluginExecutor(processLabel, config.plugins);
  const { hooks } = plugin;
  await plugin.scanPlugins(`ENGINE`, config.app.customPluginsPath, config.plugins)
    .catch((error) => { throw error });

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.ENGINE.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.ENGINE.PROCESS.SPAWN, null, hooks.ENGINE.PROCESS.ERROR);

  const gatewaysEngine = require(`@/_core/kernel/kernel-engine`)({ config, plugin });

  /* HOOK >> */ await plugin.run(hooks.ENGINE.PROCESS.BOOTSTRAP, null, hooks.ENGINE.PROCESS.ERROR);

  const startup = require(`@/utils/logger/logger-startup`);
  await startup.stepWrap(`BOOTSTRAP: ENGINE`, async () => {
    startup.startupInfoLog(`Waiting for network engine readiness`);
    await gatewaysEngine.networkEngine.startupPromise;

    // drop user privileges
    if (process.getuid && process.getuid() === 0) {
      const processLabel = process.env.PROCESS_LABEL ?? `engine_0`;
      const processUser = process.env.PROCESS_USER ?? resolveProcessUser(processLabel);
      const processGroup = process.env.PROCESS_GROUP ?? resolveProcessGroup(processLabel, processUser);
      startup.startupInfoLog(`Switching engine process privileges to ${processUser}:${processGroup}`);
      process.setgid(processGroup); process.setuid(processUser);
    }

    const { rpcEndpoint } = gatewaysEngine;
    BootResolver.registerStateReporter(async (state, data = {}) => {
      await rpcEndpoint.ask({
        target: `main`,
        question: `state`,
        data: { state, ...data }
      });
    });

    const heartbeatHealth = require(path.join(__dirname, `..`, `utils`, `heartbeat-health.js`));
    startup.startupInfoLog(`Enabling engine heartbeat reporting`);
    heartbeatHealth.setHeartbeatCallback((data) => {
      rpcEndpoint.ask({
        target: `main`,
        question: `heartbeat`,
        data
      }).catch(() => { });
    }, { processLabel: process.env.PROCESS_LABEL ?? `engine` });

    startup.startupInfoLog(`Notifying main process that engine is ready`);
    rpcEndpoint.ask({
      target: `main`,
      question: `state`,
      data: {
        state: `ready`
      }
    }).catch(() => { });
  });

  /* HOOK >> */ await plugin.run(hooks.ENGINE.PROCESS.READY, null, hooks.ENGINE.PROCESS.ERROR);
}
