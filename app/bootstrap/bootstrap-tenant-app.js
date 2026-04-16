// bootstrap/bootstrap-tenant-app.js


'use strict';


require(`module-alias/register`);
const { resolveProcessUser, resolveProcessGroup } = require(`@/config/runtime-policy`);
const fs = require(`fs`);
const path = require(`path`);
const heartbeatHealth = require(path.join(__dirname, `..`, `utils`, `heartbeat-health.js`));

/**
 * Boots one tenant app child process and serves controller 
 * execution for a single tenant host label.
 */
async function boot() {
  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  // PLUGIN EXECUTOR
  const PluginExecutor = require(`@/_core/boot/plugin-executor`);
  const tenantLabel = process.argv[4] ?? null;
  const processLabel = tenantLabel ?? process.env.PROCESS_LABEL ?? `tenant`;
  const plugin = new PluginExecutor(processLabel, config.plugins);
  const { hooks } = plugin;
  await plugin.scanPlugins(`TENANT`, config.app.customPluginsPath, config.plugins)
    .catch((error) => { throw error });

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.TENANT.PROCESS);

  /* HOOK >> */ await plugin.run(hooks.TENANT.PROCESS.SPAWN, null, hooks.TENANT.PROCESS.ERROR);

  const gatewaysTenantApp = require(`@/_core/kernel/kernel-tenant-app`)({ config, plugin });

  /* HOOK >> */ await plugin.run(hooks.TENANT.PROCESS.BOOTSTRAP, null, hooks.TENANT.PROCESS.ERROR);

  const startup = require(`@/utils/logger/logger-startup`);
  await startup.stepWrap(`BOOTSTRAP: TENANT APP`, async () => {
    const { rpcEndpoint, storageService, sharedCacheService } = gatewaysTenantApp;

    const tenantHost = process.argv[2] ?? null;
    const tenantRoot = process.argv[3] ?? process.cwd();
    const tenantAppPath = path.join(tenantRoot, `src`, `app`);

    try { // drop user privileges
      if (process.getuid && process.getuid() === 0) {
        const processLabel = tenantLabel ?? `tenant_${tenantHost ?? `tenant`}`;
        const processUser = process.env.PROCESS_USER ?? resolveProcessUser(processLabel);
        const processGroup = process.env.PROCESS_GROUP ?? resolveProcessGroup(processLabel, processUser);
        startup.startupInfoLog(`Switching tenant app privileges to ${processUser}:${processGroup}`);
        process.setgid(processGroup); process.setuid(processUser);
      }
    } catch (e) {
      //USER FAIL EXIST
    }

    const services = Object.freeze({
      storage: storageService,
      cache: sharedCacheService,
      rpc: rpcEndpoint
    });
    BootResolver.registerStateReporter(async (state, data = {}) => {
      await rpcEndpoint.ask({
        target: `main`,
        question: `state`,
        data: { state, ...data }
      });
    });
    startup.startupInfoLog(`Loading tenant app entrypoint from ${tenantAppPath}/index.js`);
    const tenantApp = await bootTenantAppEntrypoint({
      tenantAppPath,
      tenantRoot,
      tenantHost,
      tenantLabel,
      services
    });

    const controllerCache = new Map();
    const question = config.requestPipeline?.question?.tenantController ?? `tenantController`;
    const tenantRuntime = {
      draining: false,
      activeControllerRequests: 0
    };

    BootResolver.registerDrainHandler(async ({ timeoutMs = 1000 }) => {
      tenantRuntime.draining = true;
      const startedAt = Date.now();
      while (tenantRuntime.activeControllerRequests > 0) {
        if (Date.now() - startedAt >= timeoutMs) break;
        await new Promise((resolve) => {
          const wait = setTimeout(resolve, 10);
          wait.unref?.();
        });
      }
    });

    startup.startupInfoLog(`Registering tenant controller request handler`);
    rpcEndpoint.addListener(question, async ({ tenantRoute, requestData, sessionData }, resolve) => {
      if (tenantRuntime.draining) {
        resolve(createControllerFailureResponse(503, `Tenant process is draining`, {
          controllerId: tenantRoute?.controller ?? null,
          reason: `draining`
        }));
        return false;
      }

      tenantRuntime.activeControllerRequests += 1;
      const controllerStartedAt = Date.now();
      try {
        const response = await handleTenantControllerRequest({
          tenantRoute,
          requestData,
          sessionData,
          tenantAppPath,
          tenantRoot,
          tenantLabel,
          tenantApp,
          services,
          controllerCache
        });
        resolve(response, {
          controllerMeta: {
            controllerMs: Date.now() - controllerStartedAt
          }
        });
      } finally {
        if (tenantRuntime.activeControllerRequests > 0) {
          tenantRuntime.activeControllerRequests -= 1;
        } else {
          tenantRuntime.activeControllerRequests = 0;
        }
      }
      return false;
    });

    startup.startupInfoLog(`Enabling tenant app heartbeat reporting`);
    heartbeatHealth.setHeartbeatCallback((data) => {
      rpcEndpoint.ask({
        target: `main`,
        question: `heartbeat`,
        data
      }).catch(() => { });
    }, { processLabel });

    startup.startupInfoLog(`Notifying main process that tenant app is ready`);
    rpcEndpoint.ask({
      target: `main`,
      question: `state`,
      data: {
        state: `ready`
      }
    }).catch(() => { });
  });


  /* HOOK >> */ await plugin.run(hooks.TENANT.PROCESS.READY, null, hooks.TENANT.PROCESS.ERROR);
}

async function bootTenantAppEntrypoint({
  tenantAppPath,
  tenantRoot,
  tenantHost,
  tenantLabel,
  services
}) {
  const entryPath = path.join(tenantAppPath, `index.js`);
  if (!fs.existsSync(entryPath)) return null;

  const tenantEntrypoint = require(entryPath);
  const bootHandler = resolveTenantAppBootHandler(tenantEntrypoint);
  if (typeof bootHandler !== `function`) {
    return tenantEntrypoint;
  }

  return await bootHandler(Object.freeze({
    tenantRoot,
    tenantHost,
    tenantLabel,
    services
  }));
}

function resolveTenantAppBootHandler(tenantEntrypoint) {
  if (typeof tenantEntrypoint === `function`) return tenantEntrypoint;
  if (tenantEntrypoint && typeof tenantEntrypoint.boot === `function`) return tenantEntrypoint.boot;
  if (tenantEntrypoint?.default && typeof tenantEntrypoint.default === `function`) return tenantEntrypoint.default;
  if (tenantEntrypoint?.default && typeof tenantEntrypoint.default.boot === `function`) return tenantEntrypoint.default.boot;
  return null;
}

function loadController(controllerId, tenantAppPath, controllerCache) {
  const resolved = resolveControllerPath(controllerId, tenantAppPath);
  const cacheKey = require.resolve(resolved);
  const currentMtimeMs = fs.statSync(cacheKey).mtimeMs;
  const cachedEntry = controllerCache.get(cacheKey);
  if (!cachedEntry || cachedEntry.mtimeMs !== currentMtimeMs) {
    delete require.cache[cacheKey];
    controllerCache.set(cacheKey, {
      module: require(cacheKey),
      mtimeMs: currentMtimeMs
    });
  }
  return controllerCache.get(cacheKey).module;
}

function resolveControllerHandler(controllerModule, call) {
  if (call && controllerModule && typeof controllerModule[call] === `function`) {
    return controllerModule[call];
  }
  if (controllerModule && typeof controllerModule.default === `function`) {
    return controllerModule.default;
  }
  if (typeof controllerModule === `function`) {
    return controllerModule;
  }
  return null;
}

function resolveControllerPath(controllerId, tenantAppPath) {
  const path = require(`path`);
  if (path.isAbsolute(controllerId)) return controllerId;
  return path.join(tenantAppPath, controllerId);
}

function isControllerLoadError(error) {
  return error?.code === `MODULE_NOT_FOUND` || error?.code === `ENOENT`;
}

function createControllerFailureResponse(status, body, details = null) {
  return {
    success: false,
    status,
    body,
    error: details
  };
}

async function handleTenantControllerRequest({
  tenantRoute,
  requestData,
  sessionData,
  tenantAppPath,
  tenantRoot,
  tenantLabel,
  tenantApp,
  services,
  controllerCache = new Map()
}) {
  const controllerId = tenantRoute?.controller;
  if (!controllerId) return { status: 404, body: `Controller not found` };

  try {
    const controllerModule = loadController(controllerId, tenantAppPath, controllerCache);
    const handler = resolveControllerHandler(controllerModule, tenantRoute?.call);

    if (typeof handler !== `function`) {
      return createControllerFailureResponse(500, `Invalid controller handler`, {
        controllerId,
        call: tenantRoute?.call ?? null
      });
    }

    const context = Object.freeze({
      tenantRoute,
      requestData,
      sessionData,
      tenantRoot,
      tenantLabel,
      tenantApp,
      services
    });

    return await handler(context);
  } catch (error) {
    if (isControllerLoadError(error)) {
      return createControllerFailureResponse(404, `Controller not found`, {
        controllerId,
        error: error?.message ?? String(error)
      });
    }

    return createControllerFailureResponse(500, `Controller load failure`, {
      controllerId,
      error: error?.message ?? String(error)
    });
  }
}

if (require.main === module) {
  boot();
}

module.exports = Object.freeze({
  boot,
  handleTenantControllerRequest
});
