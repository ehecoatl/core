'use strict';

const DEFAULT_QUESTIONS = Object.freeze({
  snapshot: `observability.snapshot`,
  processes: `observability.processes`,
  health: `observability.health`,
  reloadProcess: `observability.reloadProcess`,
  shutdownProcess: `observability.shutdownProcess`
});

const registeredQuestions = new Set();
const registeredRemovers = new Map();

module.exports = {
  name: `ObservabilitySurface`,
  priority: 0,
  contexts: [`MAIN`],
  contextContracts: {
    MAIN: `main.v1`
  },

  async register(executor, pluginContext) {
    const mainHooks = executor.hooks?.MAIN?.PROCESS;
    if (!mainHooks?.READY) return;

    executor.on(mainHooks.READY, () => {
      registerRpcSurface({
        executor,
        pluginContext
      });
    }, this.pluginMeta);
  },

  async teardown() {
    for (const [question, remove] of registeredRemovers.entries()) {
      try {
        remove(question);
      } catch {
        // Plugin teardown must not make process shutdown brittle.
      }
    }
    registeredQuestions.clear();
    registeredRemovers.clear();
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  }
};

function registerRpcSurface({
  executor,
  pluginContext
}) {
  const config = executor.getPluginConfig?.(module.exports.name) ?? {};
  const questions = normalizeQuestions(config.questions);
  const allowedApps = normalizeAllowedApps(config.allowedApps);

  const register = (question, handler) => {
    if (!question || registeredQuestions.has(question)) return;
    pluginContext.rpc.addListener(question, handler);
    registeredQuestions.add(question);
    registeredRemovers.set(question, pluginContext.rpc.removeListener);
  };

  register(questions.snapshot, (payload = {}) => {
    const denied = authorize(payload, allowedApps);
    if (denied) return denied;

    return ok({
      service: {
        contextName: pluginContext.contextName,
        processLabel: pluginContext.processLabel,
        observedAt: new Date().toISOString()
      },
      counts: pluginContext.supervision.getProcessCounts(),
      processes: pluginContext.supervision.listProcesses(),
      health: pluginContext.supervision.getHeartbeatHealth(),
      lifecycle: pluginContext.supervision.getLifecycleHistory()
    });
  });

  register(questions.processes, (payload = {}) => {
    const denied = authorize(payload, allowedApps);
    if (denied) return denied;
    return ok(pluginContext.supervision.listProcesses());
  });

  register(questions.health, (payload = {}) => {
    const denied = authorize(payload, allowedApps);
    if (denied) return denied;
    const label = normalizeString(payload.label);
    return ok(pluginContext.supervision.getHeartbeatHealth(label));
  });

  register(questions.reloadProcess, (payload = {}) => {
    const denied = authorize(payload, allowedApps);
    if (denied) return denied;
    const label = normalizeString(payload.label);
    if (!label) return fail(`OBSERVABILITY_INVALID_REQUEST`, `Missing process label`);
    return ok({
      label,
      requested: pluginContext.supervision.reloadProcess(
        label,
        normalizeString(payload.reason) ?? `observability_reload`
      )
    });
  });

  register(questions.shutdownProcess, async (payload = {}) => {
    const denied = authorize(payload, allowedApps);
    if (denied) return denied;
    const label = normalizeString(payload.label);
    if (!label) return fail(`OBSERVABILITY_INVALID_REQUEST`, `Missing process label`);
    const timeoutMs = normalizePositiveInteger(payload.timeoutMs);
    return ok({
      label,
      success: await pluginContext.supervision.shutdownProcess(
        label,
        normalizeString(payload.reason) ?? `observability_shutdown`,
        timeoutMs
      )
    });
  });
}

function normalizeQuestions(questions = {}) {
  return Object.freeze({
    snapshot: normalizeString(questions.snapshot) ?? DEFAULT_QUESTIONS.snapshot,
    processes: normalizeString(questions.processes) ?? DEFAULT_QUESTIONS.processes,
    health: normalizeString(questions.health) ?? DEFAULT_QUESTIONS.health,
    reloadProcess: normalizeString(questions.reloadProcess) ?? DEFAULT_QUESTIONS.reloadProcess,
    shutdownProcess: normalizeString(questions.shutdownProcess) ?? DEFAULT_QUESTIONS.shutdownProcess
  });
}

function normalizeAllowedApps(allowedApps = []) {
  const pairs = new Set();
  for (const app of Array.isArray(allowedApps) ? allowedApps : []) {
    const tenantId = normalizeString(app?.tenantId);
    const appId = normalizeString(app?.appId);
    if (!tenantId || !appId) continue;
    pairs.add(`${tenantId}:${appId}`);
  }
  return pairs;
}

function authorize(payload = {}, allowedApps) {
  const appRpcContext = payload?.internalMeta?.appRpcContext ?? {};
  const tenantId = normalizeString(appRpcContext.tenantId);
  const appId = normalizeString(appRpcContext.appId);
  if (!tenantId || !appId) {
    return fail(`OBSERVABILITY_UNIDENTIFIED_APP`, `Missing app RPC identity`);
  }
  if (!allowedApps.has(`${tenantId}:${appId}`)) {
    return fail(`OBSERVABILITY_FORBIDDEN`, `App is not allowed to access observability`);
  }
  return null;
}

function ok(data) {
  return {
    success: true,
    data
  };
}

function fail(code, error) {
  return {
    success: false,
    code,
    error
  };
}

function normalizeString(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizePositiveInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

Object.freeze(module.exports);
