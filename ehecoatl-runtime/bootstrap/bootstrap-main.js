// bootstrap/bootstrap-main.js


'use strict';

require(`module-alias/register`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);
const {
  PRIVILEGED_HOST_OPERATION_QUESTION,
  requestPrivilegedHostOperation
} = require(`@/scripts/privileged-host-bridge`);

/**
 * Boots the root main process, loads core use cases,
 * and starts the supervised child process tree.
 */
module.exports = async function boot() {
  applyProcessIdentityFromEnv({ requireIdentity: false });

  await ensureBootstrapCapabilitiesSanitized({
    keepCapabilities: [`setuid`, `setgid`]
  });

  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  const processLabel = process.env.PROCESS_LABEL ?? `main`;
  const useCasesMain = await require(`@/_core/kernel/kernel-main`)({ config, processLabel });
  const plugin = useCasesMain.pluginOrchestrator;
  const { hooks } = plugin;

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.MAIN.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.SPAWN, null, hooks.MAIN.PROCESS.ERROR);

  BootResolver.registerShutdownTask(async ({ source }) => {
    const shutdownReason = normalizeShutdownReason(source);
    await useCasesMain.processForkRuntime?.shutdownAllChildren?.(shutdownReason);
  }, -100);

  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.BOOTSTRAP, null, hooks.MAIN.PROCESS.ERROR);

  console.log(`BOOTSTRAP: MAIN`);

  const { multiProcessOrchestrator, rpcRouter } = useCasesMain;

  rpcRouter.endpoint.addListener(PRIVILEGED_HOST_OPERATION_QUESTION, async ({ operation, payload = {} }) => {
    console.log(`[PRIVILEGED HOST] main received operation=${operation}`);
    const result = await requestPrivilegedHostOperation({ operation, payload });
    console.log(`[PRIVILEGED HOST] main completed operation=${operation}`);
    return {
      success: true,
      result
    };
  });

  console.log(`Starting director process through MultiProcessOrchestrator`);
  await multiProcessOrchestrator.forkProcess(`supervisionScope`, `director`, {});

  // ISOLATED RUNTIME AUTO-SPAWN ON ROUTE
  console.log(`Registering isolated runtime auto-spawn routing`);
  rpcRouter.bindTemporarySpawner(`e_app_`, async (
    _endpointTarget,
    payload
  ) => {
    const appRoot = payload?.data?.tenantRoute?.rootFolder;
    const tenantId = payload?.data?.tenantRoute?.tenantId;
    const appId = payload?.data?.tenantRoute?.appId;
    await multiProcessOrchestrator.forkProcess(`appScope`, `isolatedRuntime`, {
      tenantId,
      appId,
      appRoot,
      appDomain: payload?.data?.tenantRoute?.domain ?? null,
      appName: payload?.data?.tenantRoute?.appName ?? null,
      reason: `temporary_rpc_spawn`
    });
    return true;
  });

  console.log(`Registering main direct-message RPC handlers`);

  /* HOOK >> */ await plugin.run(hooks.MAIN.PROCESS.READY, null, hooks.MAIN.PROCESS.ERROR);
};

function normalizeShutdownReason(source) {
  if (!source || source === `signal`) {
    return `shutdown`;
  }

  return source;
}

Object.freeze(module.exports);

if (require.main === module) {
  module.exports().catch(async (error) => {
    console.error(`[FATAL MAIN BOOTSTRAP ERROR]`);
    console.error(error);
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.exit(1);
  });
}
