// plugins/logger-runtime.js


'use strict';

const PROCESS_CONTEXTS = [`MAIN`, `MANAGER`, `ENGINE`, `TENANT`];
const { createHourlyFileLogger } = require(`@/utils/logger/hourly-file-logger`);
const { createTenantReportWriter } = require(`@/utils/observability/tenant-report-writer`);

let hourlyFileLogger = null;
let tenantReportWriter = null;

function getTimestamp() {
  return new Date().toISOString();
}

function formatPrefix() {
  return `[${getTimestamp()}]`;
}

function formatValue(value) {
  if (value == null) return null;
  if (typeof value === `string`) return value;
  if (typeof value === `number` || typeof value === `boolean`) return String(value);
  if (value instanceof Error) return formatError(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatError(error) {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return formatValue(error) ?? `Unknown error`;
}

function compactDetails(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== ``)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(` `);
}

function logLine(message, details = null) {
  const suffix = details ? ` ${details}` : ``;
  const line = `${formatPrefix()} ${message}${suffix}`;
  console.log(line);
  hourlyFileLogger?.writeRuntime(line);
}

function logErrorLine(message, error = null, details = null) {
  const base = details ? `${message} ${details}` : message;
  if (error) {
    const firstLine = `${formatPrefix()} ${base}`;
    const secondLine = `${formatPrefix()} ${formatError(error)}`;
    console.error(firstLine);
    console.error(secondLine);
    hourlyFileLogger?.writeError(firstLine);
    hourlyFileLogger?.writeError(secondLine);
    return;
  }

  const line = `${formatPrefix()} ${base}`;
  console.error(line);
  hourlyFileLogger?.writeError(line);
}

function registerProcessHooks(executor, pluginMeta) {
  for (const contextName of PROCESS_CONTEXTS) {
    const processHooks = executor.hooks?.[contextName]?.PROCESS;
    if (!processHooks) continue;
    const includeHeartbeat = contextName !== `MAIN`;

    executor.on(processHooks.SPAWN, (ctx) => {
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process spawn`,
        compactDetails({ processLabel: ctx?.processLabel, pid: ctx?.pid ?? process.pid })
      );
    }, pluginMeta);

    executor.on(processHooks.BOOTSTRAP, (ctx) => {
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process bootstrap`,
        compactDetails({ processLabel: ctx?.processLabel, pid: ctx?.pid ?? process.pid })
      );
    }, pluginMeta);

    executor.on(processHooks.READY, (ctx) => {
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process ready`,
        compactDetails({ processLabel: ctx?.processLabel, pid: ctx?.pid ?? process.pid })
      );
    }, pluginMeta);

    executor.on(processHooks.SHUTDOWN, (ctx) => {
      tenantReportWriter?.flushAll?.().catch(() => { });
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process shutdown`,
        compactDetails({
          processLabel: ctx?.processLabel,
          pid: ctx?.pid ?? process.pid,
          source: ctx?.source ?? null,
          signal: ctx?.signal ?? null,
          code: ctx?.code ?? null,
          reason: ctx?.reason ?? null
        })
      );
    }, pluginMeta);

    executor.on(processHooks.DEAD, (ctx) => {
      tenantReportWriter?.flushAll?.().catch(() => { });
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process dead`,
        compactDetails({
          processLabel: ctx?.processLabel,
          pid: ctx?.pid ?? process.pid,
          source: ctx?.source ?? null,
          code: ctx?.code ?? null
        })
      );
    }, pluginMeta);

    executor.on(processHooks.CRASH, (ctx) => {
      logErrorLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process crash`,
        ctx?.error ?? ctx?.reason ?? null,
        compactDetails({
          processLabel: ctx?.processLabel,
          pid: ctx?.pid ?? process.pid,
          source: ctx?.source ?? null,
          reason: ctx?.reason ?? null
        })
      );
    }, pluginMeta);

    executor.on(processHooks.RESTART, (ctx) => {
      logLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process restart`,
        compactDetails({
          processLabel: ctx?.processLabel,
          pid: ctx?.pid ?? process.pid,
          reason: ctx?.reason ?? null
        })
      );
    }, pluginMeta);

    executor.on(processHooks.ERROR, (ctx) => {
      logErrorLine(
        `[plugin:logger-runtime] ${contextName.toLowerCase()} process error`,
        ctx?.error ?? ctx?.warning ?? ctx?.reason ?? null,
        compactDetails({
          processLabel: ctx?.processLabel,
          pid: ctx?.pid ?? process.pid,
          source: ctx?.source ?? null,
          hook: ctx?.hook ?? null,
          reason: ctx?.reason ?? null
        })
      );
    }, pluginMeta);

    if (includeHeartbeat) {
      executor.on(processHooks.HEARTBEAT, (ctx) => {
        logLine(
          `[plugin:logger-runtime] ${contextName.toLowerCase()} process heartbeat`,
          compactDetails({
            processLabel: ctx?.processLabel,
            pid: ctx?.pid ?? process.pid,
            uptimeSec: ctx?.uptimeSec ?? null,
            elu: ctx?.elu ?? null,
            lagP99Ms: ctx?.lagP99Ms ?? null,
            lagMaxMs: ctx?.lagMaxMs ?? null
          })
        );
      }, pluginMeta);
    }
  }
}

function registerSupervisorHooks(executor, pluginMeta) {
  const supervisorHooks = executor.hooks?.MAIN?.SUPERVISOR;
  if (!supervisorHooks) return;

  executor.on(supervisorHooks.BOOTSTRAP, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor bootstrap`,
      compactDetails({
        processLabel: ctx?.processLabel,
        routerLabel: ctx?.routerLabel ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.READY, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor ready`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        state: ctx?.state ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.SHUTDOWN, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor shutdown`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        reason: ctx?.reason ?? null,
        state: ctx?.state ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.DEAD, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor dead`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        exitCode: ctx?.exitCode ?? null,
        signal: ctx?.signal ?? null,
        reason: ctx?.reason ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.CRASH, (ctx) => {
    logErrorLine(
      `[plugin:logger-runtime] main supervisor crash`,
      ctx?.error ?? ctx?.reason ?? null,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        previousPid: ctx?.previousPid ?? null,
        reason: ctx?.reason ?? null,
        reloadReason: ctx?.reloadReason ?? null,
        unexpected: ctx?.unexpected ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.RESTART, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor restart`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        previousPid: ctx?.previousPid ?? null,
        reason: ctx?.reason ?? null,
        unexpected: ctx?.unexpected ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.ERROR, (ctx) => {
    logErrorLine(
      `[plugin:logger-runtime] main supervisor error`,
      ctx?.error ?? ctx?.reason ?? null,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? ctx?.origin ?? null,
        pid: ctx?.pid ?? null,
        reason: ctx?.reason ?? null,
        crashReason: ctx?.crashReason ?? null,
        reloadReason: ctx?.reloadReason ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.HEARTBEAT, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor heartbeat`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.origin ?? null,
        pid: ctx?.pid ?? null,
        healthy: ctx?.health?.healthy ?? null,
        reason: ctx?.health?.reason ?? null,
        elu: ctx?.health?.elu ?? null,
        lagP99Ms: ctx?.health?.lagP99Ms ?? null,
        lagMaxMs: ctx?.health?.lagMaxMs ?? null,
        observedAt: ctx?.observedAt ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.LAUNCH.BEFORE, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor launch start`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? ctx?.processOptions?.label ?? null,
        path: ctx?.processOptions?.path ?? null,
        cwd: ctx?.processOptions?.cwd ?? null,
        processUser: ctx?.processOptions?.processUser ?? null,
        childrenTotalBefore: ctx?.processCountsBeforeLaunch?.total ?? null,
        childrenEngineBefore: ctx?.processCountsBeforeLaunch?.engine ?? null,
        childrenTenantBefore: ctx?.processCountsBeforeLaunch?.tenant ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.LAUNCH.AFTER, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor launch ready`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        path: ctx?.processOptions?.path ?? null,
        processUser: ctx?.processOptions?.processUser ?? null,
        childrenTotal: ctx?.processCounts?.total ?? null,
        childrenEngine: ctx?.processCounts?.engine ?? null,
        childrenTenant: ctx?.processCounts?.tenant ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.LAUNCH.ERROR, (ctx) => {
    logErrorLine(
      `[plugin:logger-runtime] main supervisor launch error`,
      ctx?.error ?? null,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? ctx?.processOptions?.label ?? null,
        path: ctx?.processOptions?.path ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.EXIT.BEFORE, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor exit start`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        code: ctx?.code ?? null,
        signal: ctx?.signal ?? null,
        reason: ctx?.reason ?? null,
        restartOnExit: ctx?.restartOnExit ?? null,
        childrenTotalBefore: ctx?.processCountsBeforeExit?.total ?? null,
        childrenEngineBefore: ctx?.processCountsBeforeExit?.engine ?? null,
        childrenTenantBefore: ctx?.processCountsBeforeExit?.tenant ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.EXIT.AFTER, (ctx) => {
    logLine(
      `[plugin:logger-runtime] main supervisor exit complete`,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        code: ctx?.code ?? null,
        signal: ctx?.signal ?? null,
        reason: ctx?.reason ?? null,
        restartOnExit: ctx?.restartOnExit ?? null,
        childrenTotalAfter: ctx?.processCountsAfterExit?.total ?? null,
        childrenEngineAfter: ctx?.processCountsAfterExit?.engine ?? null,
        childrenTenantAfter: ctx?.processCountsAfterExit?.tenant ?? null
      })
    );
  }, pluginMeta);

  executor.on(supervisorHooks.EXIT.ERROR, (ctx) => {
    logErrorLine(
      `[plugin:logger-runtime] main supervisor exit error`,
      ctx?.error ?? null,
      compactDetails({
        processLabel: ctx?.processLabel,
        label: ctx?.label ?? null,
        pid: ctx?.pid ?? null,
        reason: ctx?.reason ?? null
      })
    );
  }, pluginMeta);
}

function registerEngineRequestHooks(executor, pluginMeta) {
  const requestHooks = executor.hooks?.ENGINE?.REQUEST;
  if (!requestHooks?.END) return;

  executor.on(requestHooks.END, (ctx) => {
    tenantReportWriter?.observeRequest?.(ctx);
    logLine(
      `[plugin:logger-runtime] engine request complete`,
      compactDetails({
        processLabel: ctx?.processLabel,
        method: ctx?.requestData?.method ?? null,
        url: ctx?.requestData?.url ?? null,
        requestId: ctx?.meta?.requestId ?? ctx?.requestData?.requestId ?? null,
        status: ctx?.responseData?.status ?? null,
        durationMs: ctx?.meta?.duration ?? null,
        latencyProfile: ctx?.meta?.latencyProfile ?? null,
        latencyClass: ctx?.meta?.latencyClass ?? null,
        session: ctx?.meta?.session ?? null,
        cached: ctx?.meta?.cached ?? null,
        controller: ctx?.meta?.controller ?? null
      })
    );
  }, pluginMeta);
}

module.exports = {
  name: "logger-runtime",
  priority: 0,

  /** @param {import('@/_core/boot/plugin-executor.js')} executor  */
  async register(executor) {
    const runtimeConfig = executor.getPluginConfig?.(this.name) ?? {};
    const fileLoggingConfig = runtimeConfig.fileLogging ?? {};
    const tenantReportConfig = runtimeConfig.tenantReport ?? {};

    await tenantReportWriter?.close?.();
    tenantReportWriter = null;
    hourlyFileLogger?.close?.();
    hourlyFileLogger = createHourlyFileLogger({
      enabled: fileLoggingConfig.enabled === true,
      baseDir: fileLoggingConfig.baseDir,
      maxFiles: fileLoggingConfig.maxFiles,
      cleanupIntervalMs: fileLoggingConfig.cleanupIntervalMs
    });
    tenantReportWriter = createTenantReportWriter({
      enabled: tenantReportConfig.enabled === true,
      relativePath: tenantReportConfig.relativePath,
      flushIntervalMs: tenantReportConfig.flushIntervalMs
    });

    registerProcessHooks(executor, this.pluginMeta);
    registerSupervisorHooks(executor, this.pluginMeta);
    registerEngineRequestHooks(executor, this.pluginMeta);
  },

  async teardown() {
    await tenantReportWriter?.close?.();
    tenantReportWriter = null;
    hourlyFileLogger?.close?.();
    hourlyFileLogger = null;
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    }
  }
};

Object.freeze(module.exports);
