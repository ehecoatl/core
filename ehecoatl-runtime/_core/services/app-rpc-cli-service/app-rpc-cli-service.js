'use strict';

const path = require(`node:path`);
const { execFile } = require(`node:child_process`);
const { promisify } = require(`node:util`);
const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);
const { serviceInstallRoot } = require(`@/contracts/context`);
const { findOpaqueAppRecordByTenantIdAndAppIdSync } = require(`@/utils/tenancy/tenant-layout`);
const {
  resolveEhecoatlCommand,
  matchesAllowedPattern,
  normalizeAppRpcCliAppKey
} = require(`@/utils/cli/ehecoatl-command-resolver`);

const APP_RPC_CLI_QUESTION = `cli.command.run`;

class AppRpcCliService extends AdaptableUseCase {
  config;
  cliEntrypoint;
  commandsDir;
  installRoot;
  #execFile;

  constructor(kernelContext, {
    execFileImpl = execFile,
    cliEntrypoint = path.join(serviceInstallRoot, `cli`, `ehecoatl.sh`),
    commandsDir = path.join(serviceInstallRoot, `cli`, `commands`),
    installRoot = serviceInstallRoot
  } = {}) {
    super(null);
    this.config = kernelContext?.config?.appRpcCli ?? {};
    this.cliEntrypoint = cliEntrypoint;
    this.commandsDir = commandsDir;
    this.installRoot = installRoot;
    this.#execFile = promisify(execFileImpl);
  }

  async runCommandRequest({ commandLine, timeoutMs = null, internalMeta = null } = {}) {
    const appContext = normalizeAppContext(internalMeta?.appRpcContext ?? null);
    if (!appContext) {
      return createRejectedResponse(`forbidden_cli_command`, `CLI command is not allowed without an app RPC context.`);
    }

    let resolvedCommand = null;
    try {
      resolvedCommand = resolveEhecoatlCommand(commandLine, {
        commandsDir: this.commandsDir
      });
    } catch (error) {
      return createRejectedResponse(`invalid_cli_command`, error?.message ?? `Invalid CLI command.`);
    }

    const allowedPatterns = this.resolveAllowedPatterns(appContext);
    const isAllowed = allowedPatterns.some((pattern) => {
      try {
        return matchesAllowedPattern(pattern, resolvedCommand.normalizedCommandTokens);
      } catch {
        return false;
      }
    });
    if (!isAllowed) {
      return createRejectedResponse(`forbidden_cli_command`, `Command is not allowed for this app.`);
    }

    const cwd = this.resolveWorkingDirectory(appContext, resolvedCommand.scope);
    const normalizedTimeoutMs = normalizeTimeoutMs(
      timeoutMs,
      this.config?.defaultTimeoutMs ?? 10_000,
      this.config?.maxTimeoutMs ?? 30_000
    );
    const maxBuffer = normalizePositiveInteger(this.config?.maxBufferBytes, 256 * 1024);
    const executedAt = new Date().toISOString();

    try {
      const { stdout, stderr } = await this.#execFile(`bash`, [
        this.cliEntrypoint,
        resolvedCommand.scope,
        ...(resolvedCommand.targetSelector ? [resolvedCommand.targetSelector] : []),
        ...resolvedCommand.commandTokens,
        ...resolvedCommand.args
      ], {
        cwd,
        timeout: normalizedTimeoutMs,
        maxBuffer,
        encoding: `utf8`
      });

      return {
        ok: true,
        exitCode: 0,
        stdout,
        stderr,
        commandLine,
        executedAt
      };
    } catch (error) {
      return {
        ok: false,
        exitCode: typeof error?.code === `number` ? error.code : null,
        stdout: String(error?.stdout ?? ``),
        stderr: String(error?.stderr ?? error?.message ?? ``),
        commandLine,
        executedAt
      };
    }
  }

  resolveAllowedPatterns({ tenantId, appId }) {
    const appKey = normalizeAppRpcCliAppKey(tenantId, appId);
    if (!appKey) return [];

    const patterns = this.config?.apps?.[appKey];
    return Array.isArray(patterns)
      ? patterns.filter((entry) => typeof entry === `string` && entry.trim() !== ``)
      : [];
  }

  resolveWorkingDirectory({ tenantId, appId }, scope) {
    const appRecord = findOpaqueAppRecordByTenantIdAndAppIdSync({
      tenantsBase: this.config?.tenantsBase ?? `/var/opt/ehecoatl/tenants`,
      tenantId,
      appId
    });
    const appRoot = appRecord?.appRoot ?? null;
    const tenantRoot = appRecord?.tenantRoot ?? (appRoot ? path.dirname(appRoot) : null);

    switch (scope) {
      case `app`:
        return appRoot ?? this.installRoot;
      case `tenant`:
        return tenantRoot ?? this.installRoot;
      default:
        return this.installRoot;
    }
  }
}

function normalizeAppContext(appContext = null) {
  const tenantId = normalizeOpaqueId(appContext?.tenantId);
  const appId = normalizeOpaqueId(appContext?.appId);
  if (!tenantId || !appId) return null;
  return { tenantId, appId };
}

function normalizeOpaqueId(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeTimeoutMs(value, fallback, maximum) {
  const normalizedFallback = normalizePositiveInteger(fallback, 10_000);
  const normalizedMaximum = normalizePositiveInteger(maximum, 30_000);
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return Math.min(normalizedFallback, normalizedMaximum);
  }
  return Math.min(Math.floor(normalizedValue), normalizedMaximum);
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.floor(normalized);
}

function createRejectedResponse(code, message) {
  return {
    ok: false,
    code,
    message
  };
}

module.exports = {
  AppRpcCliService,
  APP_RPC_CLI_QUESTION
};

Object.freeze(module.exports);
