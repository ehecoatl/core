// bootstrap/bootstrap-isolated-runtime.js


'use strict';


require(`module-alias/register`);
const fs = require(`fs`);
const path = require(`path`);
const { setHeartbeatCallback } = require(`@/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter`);
const { ensureBootstrapCapabilitiesSanitized } = require(`@/utils/process/bootstrap-capabilities`);
const { applyProcessIdentityFromEnv } = require(`@/utils/process/apply-process-identity`);

/**
 * Boots one isolated runtime child process and serves action
 * execution for a single isolated app identity.
 */
async function boot() {
  applyProcessIdentityFromEnv();
  await ensureBootstrapCapabilitiesSanitized({
    dropIfAnyCapabilities: true
  });

  // CONFIG LOAD
  const config = await require(`@/config/default.user.config`)();

  const tenantId = process.argv[2] ?? null;
  const appId = process.argv[3] ?? null;
  const isolatedLabel = process.argv[5] ?? null;
  const processLabel = isolatedLabel ?? process.env.PROCESS_LABEL ?? `isolated`;
  const useCasesIsolatedRuntime = await require(`@/_core/kernel/kernel-isolated-runtime`)({
    config,
    processLabel,
    tenantId,
    appId
  });
  const plugin = useCasesIsolatedRuntime.pluginOrchestrator;
  const { hooks } = plugin;

  // BOOT RESOLVER
  const BootResolver = require(`@/_core/boot/boot-resolver`);
  BootResolver.setupExitHandlers(plugin, hooks.ISOLATED_RUNTIME.PROCESS);

  /* HOOK >> */ await plugin.run(
    hooks.ISOLATED_RUNTIME.PROCESS.SPAWN,
    null,
    hooks.ISOLATED_RUNTIME.PROCESS.ERROR
  );

  /* HOOK >> */ await plugin.run(
    hooks.ISOLATED_RUNTIME.PROCESS.BOOTSTRAP,
    null,
    hooks.ISOLATED_RUNTIME.PROCESS.ERROR
  );

  console.log(`BOOTSTRAP: ISOLATED RUNTIME`);
  const { rpcEndpoint, storageService, sharedCacheService, webSocketManager } = useCasesIsolatedRuntime;

  const appRoot = process.argv[4] ?? process.cwd();
  const appDomain = process.argv[6] ?? null;
  const appName = process.argv[7] ?? null;

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
  console.log(`Loading isolated runtime entrypoint from ${appRoot}/index.js`);
  const { isolatedApp, appTopology } = await bootIsolatedAppEntrypoint({
    appRoot,
    appDomain,
    appName,
    tenantId,
    appId,
    isolatedLabel,
    webSocketManager,
    services
  });

  const actionCache = new Map();
  const question = config.adapters.middlewareStackOrchestrator?.question?.tenantAction ?? `tenantAction`;
  const isolatedRuntimeState = {
    draining: false,
    activeActionRequests: 0
  };

  BootResolver.registerDrainHandler(async ({ timeoutMs = 1000 }) => {
    isolatedRuntimeState.draining = true;
    const startedAt = Date.now();
    while (isolatedRuntimeState.activeActionRequests > 0) {
      if (Date.now() - startedAt >= timeoutMs) break;
      await new Promise((resolve) => {
        const wait = setTimeout(resolve, 10);
        wait.unref?.();
      });
    }
  });

  console.log(`Registering isolated runtime action request handler`);
  rpcEndpoint.addListener(question, async ({ tenantRoute, requestData, sessionData }, resolve) => {
    if (isolatedRuntimeState.draining) {
      resolve(createActionFailureResponse(503, `Isolated runtime is draining`, {
        run: tenantRoute?.run ?? null,
        resource: tenantRoute?.run?.resource ?? null,
        action: tenantRoute?.run?.action ?? null,
        reason: `draining`
      }));
      return false;
    }

    isolatedRuntimeState.activeActionRequests += 1;
    const actionStartedAt = Date.now();
    try {
      const response = await handleIsolatedActionRequest({
        tenantRoute,
        requestData,
        sessionData,
        appRoot,
        isolatedLabel,
        isolatedApp,
        appTopology,
        services,
        actionCache
      });
      resolve(response, {
        actionMeta: {
          actionMs: Date.now() - actionStartedAt
        }
      });
    } finally {
      if (isolatedRuntimeState.activeActionRequests > 0) {
        isolatedRuntimeState.activeActionRequests -= 1;
      } else {
        isolatedRuntimeState.activeActionRequests = 0;
      }
    }
    return false;
  });

  console.log(`Enabling isolated runtime heartbeat reporting`);
  setHeartbeatCallback((data) => {
    rpcEndpoint.ask({
      target: `main`,
      question: config.adapters.watchdogOrchestrator?.question?.heartbeat ?? `heartbeat`,
      data
    }).catch(() => { });
  }, { processLabel });

  console.log(`Notifying main process that isolated runtime is ready`);
  rpcEndpoint.ask({
    target: `main`,
    question: `state`,
    data: {
      state: `ready`
    }
  }).catch(() => { });


  /* HOOK >> */ await plugin.run(
    hooks.ISOLATED_RUNTIME.PROCESS.READY,
    null,
    hooks.ISOLATED_RUNTIME.PROCESS.ERROR
  );
}

async function bootIsolatedAppEntrypoint({
  appRoot,
  appDomain,
  appName,
  isolatedLabel,
  webSocketManager,
  services
}) {
  const entryPath = path.join(appRoot, `index.js`);
  if (!fs.existsSync(entryPath)) {
    return {
      isolatedApp: null,
      appTopology: null
    };
  }

  const isolatedEntrypoint = require(entryPath);
  const baseBootContext = Object.freeze({
    appRoot,
    appDomain,
    appName,
    isolatedLabel,
    webSocketManager,
    services
  });
  const appTopology = await resolveIsolatedAppTopology(isolatedEntrypoint, baseBootContext);
  const bootContext = Object.freeze({
    ...baseBootContext,
    appTopology
  });
  const bootHandler = resolveIsolatedAppBootHandler(isolatedEntrypoint);
  if (typeof bootHandler !== `function`) {
    return {
      isolatedApp: isolatedEntrypoint,
      appTopology
    };
  }

  return {
    isolatedApp: await bootHandler(bootContext),
    appTopology
  };
}

function resolveIsolatedAppBootHandler(isolatedEntrypoint) {
  if (typeof isolatedEntrypoint === `function`) return isolatedEntrypoint;
  if (isolatedEntrypoint && typeof isolatedEntrypoint.boot === `function`) return isolatedEntrypoint.boot;
  if (isolatedEntrypoint?.default && typeof isolatedEntrypoint.default === `function`) return isolatedEntrypoint.default;
  if (isolatedEntrypoint?.default && typeof isolatedEntrypoint.default.boot === `function`) return isolatedEntrypoint.default.boot;
  return null;
}

async function resolveIsolatedAppTopology(isolatedEntrypoint, context) {
  const declaration = resolveIsolatedAppTopologyDeclaration(isolatedEntrypoint);
  if (declaration == null) return null;

  const topology = typeof declaration === `function`
    ? await declaration(context)
    : declaration;

  if (!isPlainObject(topology)) {
    throw new Error(`Isolated app topology must resolve to a plain object`);
  }

  return topology;
}

function resolveIsolatedAppTopologyDeclaration(isolatedEntrypoint) {
  if (!isolatedEntrypoint || (typeof isolatedEntrypoint !== `object` && typeof isolatedEntrypoint !== `function`)) {
    return null;
  }
  if (isolatedEntrypoint.topology != null) return isolatedEntrypoint.topology;
  if (isolatedEntrypoint.default?.topology != null) return isolatedEntrypoint.default.topology;
  return null;
}

function isPlainObject(value) {
  return value != null
    && typeof value === `object`
    && !Array.isArray(value);
}

function loadAction(resolvedPath, actionCache) {
  const cacheKey = require.resolve(resolvedPath);
  const currentMtimeMs = fs.statSync(cacheKey).mtimeMs;
  const cachedEntry = actionCache.get(cacheKey);
  if (!cachedEntry || cachedEntry.mtimeMs !== currentMtimeMs) {
    delete require.cache[cacheKey];
    actionCache.set(cacheKey, {
      module: require(cacheKey),
      mtimeMs: currentMtimeMs
    });
  }
  return actionCache.get(cacheKey).module;
}

function resolveActionHandler(actionModule, actionName) {
  if (actionName && actionModule && typeof actionModule[actionName] === `function`) {
    return actionModule[actionName];
  }
  if (actionModule && typeof actionModule.default === `function`) {
    return actionModule.default;
  }
  if (typeof actionModule === `function`) {
    return actionModule;
  }
  return null;
}

function resolveActionPath(resource, appRoot, actionsRootFolder = null, appTopology = null) {
  const path = require(`path`);
  if (path.isAbsolute(resource)) return resource;
  const resolvedActionsRootFolder = actionsRootFolder
    ?? resolveTopologyPath(appTopology, [`app`, `http`, `actions`])
    ?? path.join(appRoot, `actions`);
  const normalizedResource = String(resource ?? ``).trim().replaceAll(`\\`, `/`).replace(/^\/+/, ``);
  const filename = normalizedResource.endsWith(`.js`) ? normalizedResource : `${normalizedResource}.js`;
  return path.join(resolvedActionsRootFolder, filename);
}

function resolveTopologyPath(topology, segments = []) {
  let current = topology;
  for (const segment of segments) {
    if (!isPlainObject(current)) return null;
    current = current[segment];
  }
  return typeof current === `string` && current.trim() ? current : null;
}

function isActionLoadError(error) {
  return error?.code === `MODULE_NOT_FOUND` || error?.code === `ENOENT`;
}

function createActionFailureResponse(status, body, details = null) {
  return {
    success: false,
    status,
    body,
    error: details
  };
}

async function handleIsolatedActionRequest({
  tenantRoute,
  requestData,
  sessionData,
  appRoot,
  isolatedLabel,
  isolatedApp,
  appTopology,
  services,
  actionCache = new Map()
}) {
  const runTarget = formatRunTarget(tenantRoute?.target?.run ?? null);
  const resource = tenantRoute?.target?.run?.resource ?? null;
  const actionName = tenantRoute?.target?.run?.action ?? null;
  if (!resource || !actionName) return { status: 404, body: `Action not found` };

  try {
    const actionModule = loadAction(
      resolveActionPath(
        resource,
        appRoot,
        tenantRoute?.folders?.actionsRootFolder,
        appTopology
      ),
      actionCache
    );
    const handler = resolveActionHandler(actionModule, actionName);

    if (typeof handler !== `function`) {
      return createActionFailureResponse(500, `Invalid action handler`, {
        run: runTarget,
        resource,
        action: actionName
      });
    }

    const context = Object.freeze({
      tenantRoute,
      requestData,
      sessionData,
      appRoot,
      isolatedLabel,
      isolatedApp,
      appTopology,
      services
    });

    return await handler(context);
  } catch (error) {
    if (isActionLoadError(error)) {
      return createActionFailureResponse(404, `Action not found`, {
        run: runTarget,
        resource,
        action: actionName,
        error: error?.message ?? String(error)
      });
    }

    return createActionFailureResponse(500, `Action load failure`, {
      run: runTarget,
      resource,
      action: actionName,
      error: error?.message ?? String(error)
    });
  }
}

function formatRunTarget(runTarget) {
  if (!runTarget || typeof runTarget !== `object`) return null;
  const resource = String(runTarget.resource ?? ``).trim();
  const action = String(runTarget.action ?? ``).trim();
  if (!resource) return null;
  return `${resource}@${action || `index`}`;
}

if (require.main === module) {
  boot();
}

module.exports = Object.freeze({
  boot,
  bootIsolatedAppEntrypoint,
  handleIsolatedActionRequest,
  _internal: Object.freeze({
    resolveActionPath,
    resolveIsolatedAppBootHandler,
    resolveIsolatedAppTopology,
    resolveIsolatedAppTopologyDeclaration,
    resolveTopologyPath
  })
});
