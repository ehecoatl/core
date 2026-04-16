// plugins/process-firewall.js


'use strict';

const { spawn } = require(`node:child_process`);
const { getFirewallCommandArgs } = require(`@/config/runtime-policy`);
const { resolveInboundFirewallChainName } = require(`@/utils/security/firewall-chain-name`);

function classifyLabel(label) {
  if (label === `manager`) return `manager`;
  if (label?.startsWith(`engine_`)) return `engine`;
  if (label?.startsWith(`tenant_`)) return `tenant`;
  return `other`;
}

function shouldApplyForLabel(label, applyTo = {}) {
  const kind = classifyLabel(label);
  if (kind === `manager`) return applyTo.manager !== false;
  if (kind === `tenant`) return applyTo.tenant !== false;
  if (kind === `engine`) return applyTo.engine === true;
  return applyTo.otherNonEngine === true;
}

function resolveSetupCommand(config, processUser, label) {
  const base = Array.isArray(config.setupCommand) && config.setupCommand.length > 0
    ? config.setupCommand
    : getFirewallCommandArgs(`setup`);
  const chainName = resolveInboundFirewallChainName(processUser, label);
  return [...base, processUser, label, chainName];
}

function resolveClearCommand(config, processUser, label) {
  const base = Array.isArray(config.clearCommand) && config.clearCommand.length > 0
    ? config.clearCommand
    : getFirewallCommandArgs(`release`);
  const chainName = resolveInboundFirewallChainName(processUser, label);
  return [...base, processUser, label, chainName];
}

function runLifecycleCommand(commandArgs, {
  timeoutMs = 5000,
  stdio = `pipe`
} = {}) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    return Promise.reject(new Error(`process-firewall command is missing`));
  }
  const [command, ...args] = commandArgs;
  if (!command || typeof command !== `string`) {
    return Promise.reject(new Error(`process-firewall command executable is invalid`));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stderrText = ``;
    const child = spawn(command, args, {
      stdio: [`ignore`, `ignore`, stdio],
      shell: false
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(`SIGKILL`); } catch { }
      reject(new Error(`process-firewall command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stderr?.on(`data`, (chunk) => {
      if (stderrText.length > 4096) return;
      stderrText += String(chunk);
    });

    child.on(`error`, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on(`exit`, (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      const details = stderrText.trim();
      reject(new Error(
        `process-firewall command failed (code=${code ?? `null`} signal=${signal ?? `null`})${details ? `: ${details}` : ``}`
      ));
    });
  });
}

function createFirewallLifecycle(config = {}, {
  runCommand = runLifecycleCommand
} = {}) {
  async function applyFirewallForContext({
    label,
    processUser,
    timeoutMs,
    strictSetup
  }) {
    const setupCommand = resolveSetupCommand(config, processUser, label);
    try {
      await runCommand(setupCommand, { timeoutMs });
      return {
        setupCommand,
        applied: true
      };
    } catch (error) {
      if (strictSetup) throw error;
      console.error(
        `[plugin:process-firewall] setup failed for "${label}" but launch will continue: ${error?.message ?? error}`
      );
      return {
        setupCommand,
        applied: false
      };
    }
  }

  async function clearFirewallForResource(resource, timeoutMs) {
    if (!resource?.applied || resource?.released) return;
    resource.released = true;
    try {
      await runCommand(resource.clearCommand, {
        timeoutMs
      });
    } catch (error) {
      console.error(
        `[plugin:process-firewall] failed to clear firewall for ${resource.label ?? `unknown`}: ${error?.message ?? error}`
      );
    }
  }

  return {
    async onLaunchBefore(ctx) {
      if (config.enabled === false) return;
      const processOptions = ctx?.processOptions ?? {};
      const label = processOptions.label ?? ctx?.label ?? null;
      if (!label || !shouldApplyForLabel(label, config.applyTo ?? {})) return;

      const processUser = processOptions.processUser ?? processOptions.env?.PROCESS_USER ?? null;
      if (!processUser) {
        console.warn(`[plugin:process-firewall] skipped "${label}" due to missing processUser`);
        return;
      }

      const clearCommand = resolveClearCommand(config, processUser, label);
      const timeoutMs = Number(config.commandTimeoutMs ?? 5000);
      const strictSetup = config.failOnSetupError !== false;
      const applied = await applyFirewallForContext({
        label,
        processUser,
        timeoutMs,
        strictSetup
      });
      if (!applied.applied) return;

      const resource = {
        type: `processFirewall`,
        label,
        processUser,
        setupCommand: applied.setupCommand,
        clearCommand,
        applied: true,
        released: false
      };

      ctx.resources ??= {};
      ctx.resources.processFirewall = resource;
      ctx.cleanupTasks ??= [];
      ctx.cleanupTasks.push(async () => {
        await clearFirewallForResource(resource, timeoutMs);
      });
    },

    async onLaunchAfter(ctx) {
      if (config.refreshAfterLaunch === false) return;
      const resource = ctx?.resources?.processFirewall;
      if (!resource?.applied) return;
      const timeoutMs = Number(config.commandTimeoutMs ?? 5000);
      const strictSetup = config.failOnSetupError !== false;
      const applied = await applyFirewallForContext({
        label: resource.label,
        processUser: resource.processUser,
        timeoutMs,
        strictSetup
      });
      if (applied.applied) {
        resource.setupCommand = applied.setupCommand;
      }
    },

    async onExitAfter(ctx) {
      const timeoutMs = Number(config.commandTimeoutMs ?? 5000);
      await clearFirewallForResource(ctx?.resources?.processFirewall, timeoutMs);
    }
  };
}

module.exports = {
  name: `process-firewall`,
  contexts: [`MAIN`],
  priority: 10,

  /** @param {import('@/_core/boot/plugin-executor.js')} executor */
  async register(executor) {
    const supervisorHooks = executor.hooks?.MAIN?.SUPERVISOR;
    if (!supervisorHooks?.LAUNCH || !supervisorHooks?.EXIT) return;

    const pluginConfig = executor.getPluginConfig?.(this.name) ?? {};
    const lifecycle = createFirewallLifecycle(pluginConfig, {
      runCommand: this.runCommand ?? runLifecycleCommand
    });

    executor.on(supervisorHooks.LAUNCH.BEFORE, lifecycle.onLaunchBefore, this.pluginMeta);
    executor.on(supervisorHooks.LAUNCH.AFTER, lifecycle.onLaunchAfter, this.pluginMeta);
    executor.on(supervisorHooks.EXIT.AFTER, lifecycle.onExitAfter, this.pluginMeta);
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  },

  _internal: {
    classifyLabel,
    shouldApplyForLabel,
    resolveSetupCommand,
    resolveClearCommand,
    runLifecycleCommand,
    createFirewallLifecycle
  }
};

Object.freeze(module.exports);
