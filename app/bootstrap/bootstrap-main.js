// bootstrap/bootstrap-main.js


'use strict';
const os = require(`node:os`);
const { resolveProcessUser } = require(`@/config/runtime-policy`);

/**
 * Boots the root main process, loads core gateways, 
 * and starts the supervised child process tree.
 */
module.exports = async function boot() {
  if (typeof process.getuid === `function` && process.getuid() !== 0) {
    throw new Error(`bootstrap-main requires root privileges to start the supervisor tree.`);
  }

  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  // PLUGIN EXECUTOR
  const PluginExecutor = require(`@/_core/boot/plugin-executor`);
  const processLabel = process.env.PROCESS_LABEL ?? `main`;
  const plugin = new PluginExecutor(processLabel, config.plugins);
  await plugin.scanPlugins(`MAIN`, config.app.customPluginsPath, config.plugins)
    .catch((error) => { throw error });
  const { hooks } = plugin;

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.MAIN.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.SPAWN, null, hooks.MAIN.PROCESS.ERROR);

  const gatewaysMain = require(`@/_core/kernel/kernel-main`)({ config, plugin });

  BootResolver.registerShutdownTask(async ({ source }) => {
    const shutdownReason = normalizeShutdownReason(source);
    await gatewaysMain.processSupervisor?.shutdownAllChildren?.(shutdownReason);
  }, -100);

  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.BOOTSTRAP, null, hooks.MAIN.PROCESS.ERROR);

  const startup = require(`@/utils/logger/logger-startup`);
  await startup.stepWrap(`BOOTSTRAP: MAIN`, async () => {
    const { processSupervisor, rpcRouter } = gatewaysMain;

    await startup.stepWrap(`START > MANAGER`, async () => {
      const managerLabel = `manager`;
      const managerConfig = config.processSupervisor.manager;
      startup.startupInfoLog(
        `Starting manager process "${managerLabel}" from ${managerConfig.path}`
      );
      await processSupervisor.launchProcess({
        label: managerLabel,
        path: managerConfig.path,
        processUser: resolveProcessUser(managerLabel),
        variables: [],
        cwd: process.cwd(),
        serialization: `advanced`,
        env: { ...process.env }
      });
    });

    await startup.stepWrap(`START > ENGINES`, async () => {
      const engineConfig = config.processSupervisor.engine;
      const numEngines = resolveEngineConcurrentInstances(engineConfig.concurrentInstances);
      startup.startupInfoLog(`Preparing ${numEngines} engine process${numEngines === 1 ? `` : `es`}`);
      for (let id = 0, l = numEngines; id < l; id++) {
        const engineLabel = `engine_${id}`;
        startup.startupInfoLog(
          `Starting engine process "${engineLabel}" from ${engineConfig.path}`
        );
        await processSupervisor.launchProcess({
          label: engineLabel,
          path: engineConfig.path,
          processUser: resolveProcessUser(engineLabel),
          variables: [],
          cwd: process.cwd(),
          serialization: `advanced`,
          env: { ...process.env }
        });
      }
    });

    // TENANT APP AUTO-SPAWN ON ROUTE
    startup.startupInfoLog(`Registering tenant app auto-spawn routing`);
    rpcRouter.bindTemporarySpawner(`tenant_`, async (
      endpointTarget,
      payload
    ) => {
      const tenantAppConfig = config.processSupervisor.tenantApp;
      const tenantRoot = payload?.data?.tenantRoute?.rootFolder;
      const tenantHost = payload?.data?.tenantRoute?.host;
      await processSupervisor.launchProcess({
        label: endpointTarget,
        path: tenantAppConfig.path,
        processUser: resolveProcessUser(endpointTarget),
        variables: [tenantHost, tenantRoot, endpointTarget],
        cwd: process.cwd(),
        serialization: `advanced`,
        env: { ...process.env }
      });
      return true;
    });

  });
  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.READY, null, hooks.MAIN.PROCESS.ERROR);
};

function resolveEngineConcurrentInstances(configuredValue) {
  if (configuredValue === `max`) {
    const detected = typeof os.availableParallelism === `function`
      ? os.availableParallelism()
      : os.cpus()?.length;
    return Math.max(1, Number(detected) || 1);
  }

  const parsed = Number(configuredValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.floor(parsed);
}

function normalizeShutdownReason(source) {
  if (!source || source === `signal`) {
    return `shutdown`;
  }

  return source;
}

Object.freeze(module.exports);
