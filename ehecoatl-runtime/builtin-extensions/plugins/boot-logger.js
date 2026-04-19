'use strict';

const { createHourlyFileLogger } = require(`@/utils/logger/hourly-file-logger`);
const supervisionScopeContract = require(`@/contracts/layers/supervision-scope.contract.js`);

const SUPPORTED_CONTEXTS = Object.freeze([
  `MAIN`,
  `DIRECTOR`,
  `TRANSPORT`,
  `ISOLATED_RUNTIME`
]);
const BOOT_LOG_ROOT = supervisionScopeContract?.PATHS?.LOGS?.boot?.[0] ?? `/var/log/ehecoatl/boot`;
const BOOT_LOG_WRITE_QUESTION = `bootLog.write`;

let hourlyBootLogger = null;

function getTimestamp() {
  return new Date().toISOString();
}

function resolveContextName(executor) {
  const contextName = String(executor?.currentContextName ?? ``).trim().toUpperCase();
  return SUPPORTED_CONTEXTS.includes(contextName)
    ? contextName
    : null;
}

function formatValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === `string`) return value;
  if (typeof value === `number` || typeof value === `boolean`) return String(value);
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactDetails(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== ``)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(` `);
}

function normalizeLines(ctx = {}) {
  const lines = [];

  if (typeof ctx?.message === `string` && ctx.message.trim()) {
    lines.push(ctx.message.trim());
  }

  if (Array.isArray(ctx?.lines)) {
    for (const line of ctx.lines) {
      const renderedLine = formatValue(line);
      if (renderedLine && renderedLine.trim()) lines.push(renderedLine.trim());
    }
  }

  return lines;
}

function buildBootLines(contextName, ctx = {}) {
  const details = compactDetails({
    context: contextName,
    processLabel: ctx?.processLabel ?? process.env.PROCESS_LABEL ?? process.title ?? null,
    pid: ctx?.pid ?? process.pid,
    source: ctx?.source ?? null,
    stage: ctx?.stage ?? null
  });
  const headerLine = `[${getTimestamp()}] [plugin:boot-logger] process bootstrap${details ? ` ${details}` : ``}`;
  const messageLines = normalizeLines(ctx).map((line) => `[${getTimestamp()}] ${line}`);
  const dataLine = ctx?.data && typeof ctx.data === `object`
    ? `[${getTimestamp()}] data=${formatValue(ctx.data)}`
    : null;

  return [
    headerLine,
    ...messageLines,
    ...(dataLine ? [dataLine] : [])
  ];
}

function createBootLogger(config = {}) {
  const fileLoggingConfig = config?.fileLogging ?? {};
  return createHourlyFileLogger({
    enabled: fileLoggingConfig.enabled !== false,
    baseDir: fileLoggingConfig.baseDir ?? BOOT_LOG_ROOT,
    maxFiles: fileLoggingConfig.maxFiles ?? 24,
    cleanupIntervalMs: fileLoggingConfig.cleanupIntervalMs ?? 300000,
    directHourlyRoot: true
  });
}

function writeForwardedLines(lines = [], { consoleEnabled = false } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  if (!hourlyBootLogger) {
    hourlyBootLogger = createBootLogger();
  }

  for (const line of lines) {
    if (typeof line !== `string` || !line.length) continue;
    if (consoleEnabled) console.log(line);
    hourlyBootLogger?.writeRuntime(line);
  }
}

module.exports = {
  name: `boot-logger`,
  priority: 0,
  contexts: SUPPORTED_CONTEXTS,

  /** @param {import('@/_core/orchestrators/plugin-orchestrator')} executor */
  async register(executor) {
    const contextName = resolveContextName(executor);
    if (!contextName) return;

    const processHooks = executor.hooks?.[contextName]?.PROCESS;
    if (processHooks?.BOOTSTRAP === undefined || processHooks.BOOTSTRAP === null) return;

    const config = executor.getPluginConfig?.(this.name) ?? {};
    const consoleEnabled = config.console !== false;

    hourlyBootLogger?.close?.();
    hourlyBootLogger = createBootLogger(config);

    executor.on(processHooks.BOOTSTRAP, async (ctx = {}) => {
      const lines = buildBootLines(contextName, ctx);
      const forwardBootLogLines = typeof ctx?.forwardBootLogLines === `function`
        ? ctx.forwardBootLogLines
        : null;

      for (const line of lines) {
        if (consoleEnabled) console.log(line);
      }

      if (forwardBootLogLines) {
        try {
          await forwardBootLogLines(lines);
          return;
        } catch {
          // Fall back to local write when the central writer is unavailable.
        }
      }

      for (const line of lines) {
        hourlyBootLogger?.writeRuntime(line);
      }
    }, this.pluginMeta);
  },

  async teardown() {
    hourlyBootLogger?.close?.();
    hourlyBootLogger = null;
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  },

  _internal: Object.freeze({
    SUPPORTED_CONTEXTS,
    BOOT_LOG_ROOT,
    BOOT_LOG_WRITE_QUESTION,
    resolveContextName,
    buildBootLines,
    createBootLogger,
    writeForwardedLines
  }),

  BOOT_LOG_WRITE_QUESTION,
  writeForwardedLines
};

Object.freeze(module.exports);
