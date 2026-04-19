'use strict';

const { createHourlyFileLogger } = require(`@/utils/logger/hourly-file-logger`);
const supervisionScopeContract = require(`@/contracts/layers/supervision-scope.contract.js`);

const SUPPORTED_CONTEXTS = Object.freeze([
  `MAIN`,
  `DIRECTOR`,
  `TRANSPORT`,
  `ISOLATED_RUNTIME`
]);
const ERROR_LOG_ROOT = supervisionScopeContract?.PATHS?.LOGS?.error?.[0] ?? `/var/log/ehecoatl/error`;

let hourlyErrorLogger = null;

function getTimestamp() {
  return new Date().toISOString();
}

function resolveContextName(executor) {
  const contextName = String(executor?.currentContextName ?? ``).trim().toUpperCase();
  return SUPPORTED_CONTEXTS.includes(contextName)
    ? contextName
    : null;
}

function formatErrorValue(error) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (typeof error === `string`) return error;
  if (typeof error === `number` || typeof error === `boolean`) return String(error);

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function compactDetails(details = {}) {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== ``)
    .map(([key, value]) => `${key}=${formatErrorValue(value)}`)
    .join(` `);
}

function buildErrorLines(contextName, ctx = {}) {
  const messageDetails = compactDetails({
    context: contextName,
    processLabel: ctx?.processLabel ?? process.env.PROCESS_LABEL ?? process.title ?? null,
    hook: ctx?.hook ?? null,
    source: ctx?.source ?? null,
    reason: ctx?.reason ?? null
  });
  const headerLine = `[${getTimestamp()}] [plugin:error-reporter] process error${messageDetails ? ` ${messageDetails}` : ``}`;
  const renderedError = formatErrorValue(ctx?.error ?? ctx);

  if (typeof renderedError !== `string` || !renderedError.trim()) {
    return [headerLine];
  }

  const errorLines = renderedError
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `[${getTimestamp()}] ${line}`);

  return [headerLine, ...errorLines];
}

function createErrorLogger() {
  return createHourlyFileLogger({
    enabled: true,
    baseDir: ERROR_LOG_ROOT,
    maxFiles: 24,
    cleanupIntervalMs: 300000,
    directHourlyRoot: true
  });
}

module.exports = {
  name: `error-reporter`,
  priority: 0,
  contexts: SUPPORTED_CONTEXTS,

  /** @param {import('@/_core/orchestrators/plugin-orchestrator')} executor  */
  async register(executor) {
    const contextName = resolveContextName(executor);
    if (!contextName) return;

    const processHooks = executor.hooks?.[contextName]?.PROCESS;
    if (!processHooks?.ERROR) return;

    hourlyErrorLogger?.close?.();
    hourlyErrorLogger = createErrorLogger();

    executor.on(processHooks.ERROR, async (ctx) => {
      const lines = buildErrorLines(contextName, ctx);
      for (const line of lines) {
        console.error(line);
        hourlyErrorLogger?.writeError(line);
      }
    }, this.pluginMeta);
  },

  async teardown() {
    hourlyErrorLogger?.close?.();
    hourlyErrorLogger = null;
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  },

  _internal: Object.freeze({
    SUPPORTED_CONTEXTS,
    ERROR_LOG_ROOT,
    resolveContextName,
    buildErrorLines,
    createErrorLogger
  })
};

Object.freeze(module.exports);
