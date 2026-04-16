// plugins/process-firewall.js


'use strict';

const path = require(`node:path`);
const { spawn } = require(`node:child_process`);
const { parseIsolatedRuntimeLabel } = require(`@/utils/process-labels`);
const { requestPrivilegedHostOperation } = require(`@/bootstrap/privileged-host-operations`);

const FIREWALL_COMMANDS_DIR = path.resolve(__dirname, `..`, `..`, `cli`, `commands`, `firewall`);
const LOCAL_PROXY_COMMAND = path.join(FIREWALL_COMMANDS_DIR, `newtork_local_proxy.sh`);
const WAN_BLOCK_COMMAND = path.join(FIREWALL_COMMANDS_DIR, `newtork_wan_block.sh`);

function classifyLabel(label) {
  if (label === `director`) return `director`;
  if (label?.startsWith(`transport_`) || label?.startsWith(`e_transport_`)) return `transport`;
  if (parseIsolatedRuntimeLabel(label)) return `isolated`;
  return `other`;
}

function shouldApplyForLabel(label, applyTo = {}) {
  const kind = classifyLabel(label);
  if (kind === `director`) return applyTo.director !== false;
  if (kind === `isolated`) return applyTo.isolatedRuntime !== false;
  if (kind === `transport`) return applyTo.transport !== false;
  return applyTo.otherNonEngine !== false;
}

function normalizePortList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535))]
    .sort((left, right) => left - right);
}

function toCsv(values = []) {
  return normalizePortList(values).join(`,`);
}

function resolveLocalProxyOnCommand(processUser, openLocalPorts = [], proxyPorts = []) {
  return [
    LOCAL_PROXY_COMMAND,
    `on`,
    processUser,
    toCsv(openLocalPorts),
    toCsv(proxyPorts)
  ];
}

function resolveLocalProxyOffCommand(processUser) {
  return [
    LOCAL_PROXY_COMMAND,
    `off`,
    processUser
  ];
}

function resolveWanBlockOnCommand(processUser, label) {
  return [
    WAN_BLOCK_COMMAND,
    `on`,
    processUser,
    label ?? `unknown`
  ];
}

function resolveWanBlockOffCommand(processUser, label) {
  return [
    WAN_BLOCK_COMMAND,
    `off`,
    processUser,
    label ?? `unknown`
  ];
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

  const bridgeRequest = tryBuildBridgeRequest(command, args);
  if (bridgeRequest && typeof process.send === `function`) {
    return requestPrivilegedHostOperation({
      operation: bridgeRequest.operation,
      payload: bridgeRequest.payload,
      timeoutMs
    }).then((result) => ({ code: 0, signal: null, result }));
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

function tryBuildBridgeRequest(command, args = []) {
  const commandName = path.basename(String(command ?? ``));

  if (commandName === `newtork_local_proxy.sh`) {
    const action = String(args[0] ?? ``);
    if (action === `on`) {
      return {
        operation: `firewall.localProxy.on`,
        payload: {
          processUser: String(args[1] ?? ``),
          openLocalPortsCsv: String(args[2] ?? ``),
          proxyPortsCsv: String(args[3] ?? ``)
        }
      };
    }
    if (action === `off`) {
      if (String(args[1] ?? ``) === `all`) {
        return { operation: `firewall.localProxy.offAll`, payload: {} };
      }
      return {
        operation: `firewall.localProxy.off`,
        payload: {
          processUser: String(args[1] ?? ``)
        }
      };
    }
  }

  if (commandName === `newtork_wan_block.sh`) {
    const action = String(args[0] ?? ``);
    if (action === `on`) {
      return {
        operation: `firewall.wanBlock.on`,
        payload: {
          processUser: String(args[1] ?? ``),
          label: String(args[2] ?? `unknown`)
        }
      };
    }
    if (action === `off`) {
      if (String(args[1] ?? ``) === `all`) {
        return { operation: `firewall.wanBlock.offAll`, payload: {} };
      }
      return {
        operation: `firewall.wanBlock.off`,
        payload: {
          processUser: String(args[1] ?? ``),
          label: String(args[2] ?? `unknown`)
        }
      };
    }
  }

  return null;
}

function resolveFirewallLifecycleContext(ctx, config = {}) {
  const processOptions = ctx?.processOptions ?? {};
  const label = processOptions.label ?? ctx?.label ?? null;
  const processUser = processOptions.processUser ?? processOptions.env?.PROCESS_USER ?? null;
  const openLocalPorts = normalizePortList(ctx?.executor?.kernelContext?.config?.runtime?.openlocalports ?? []);
  const proxyPorts = normalizePortList(processOptions?.firewall?.localProxyPorts ?? []);
  const timeoutMs = Number(config.commandTimeoutMs ?? 5000);
  const strictSetup = config.failOnSetupError !== false;

  return Object.freeze({
    label,
    processUser,
    openLocalPorts,
    proxyPorts,
    timeoutMs,
    strictSetup
  });
}

async function applyFirewallForContext(lifecycleContext, runCommand) {
  const {
    label,
    processUser,
    openLocalPorts,
    proxyPorts,
    timeoutMs,
    strictSetup
  } = lifecycleContext;
  const localProxyOnCommand = resolveLocalProxyOnCommand(processUser, openLocalPorts, proxyPorts);
  const wanBlockOnCommand = resolveWanBlockOnCommand(processUser, label);

  try {
    await runCommand(localProxyOnCommand, { timeoutMs });
    await runCommand(wanBlockOnCommand, { timeoutMs });
    return {
      localProxyOnCommand,
      wanBlockOnCommand,
      applied: true
    };
  } catch (error) {
    if (strictSetup) throw error;
    console.error(
      `[plugin:process-firewall] setup failed for "${label}" but launch will continue: ${error?.message ?? error}`
    );
    return {
      localProxyOnCommand,
      wanBlockOnCommand,
      applied: false
    };
  }
}

async function clearFirewallForResource(resource, timeoutMs, runCommand) {
  if (!resource?.applied || resource?.released) return;
  resource.released = true;
  try {
    await runCommand(resource.localProxyOffCommand, { timeoutMs });
  } catch (error) {
    console.error(
      `[plugin:process-firewall] failed to clear local proxy firewall for ${resource.label ?? `unknown`}: ${error?.message ?? error}`
    );
  }
  try {
    await runCommand(resource.wanBlockOffCommand, { timeoutMs });
  } catch (error) {
    console.error(
      `[plugin:process-firewall] failed to clear wan firewall for ${resource.label ?? `unknown`}: ${error?.message ?? error}`
    );
  }
}

function createFirewallLifecycle(config = {}, {
  runCommand = runLifecycleCommand
} = {}) {
  return {
    async onLaunchBefore(ctx) {
      if (config.enabled === false) return;
      const label = ctx?.processOptions?.label ?? ctx?.label ?? null;
      if (!label || !shouldApplyForLabel(label, config.applyTo ?? {})) return;

      const lifecycleContext = resolveFirewallLifecycleContext(ctx, config);
      if (!lifecycleContext.processUser) {
        console.warn(`[plugin:process-firewall] skipped "${label}" due to missing processUser`);
        return;
      }

      const applied = await applyFirewallForContext(lifecycleContext, runCommand);
      if (!applied.applied) return;

      const resource = {
        type: `processFirewall`,
        label: lifecycleContext.label,
        processUser: lifecycleContext.processUser,
        openLocalPorts: lifecycleContext.openLocalPorts,
        proxyPorts: lifecycleContext.proxyPorts,
        localProxyOnCommand: applied.localProxyOnCommand,
        wanBlockOnCommand: applied.wanBlockOnCommand,
        localProxyOffCommand: resolveLocalProxyOffCommand(lifecycleContext.processUser),
        wanBlockOffCommand: resolveWanBlockOffCommand(lifecycleContext.processUser, lifecycleContext.label),
        applied: true,
        released: false
      };

      ctx.resources ??= {};
      ctx.resources.processFirewall = resource;
      ctx.cleanupTasks ??= [];
      ctx.cleanupTasks.push(async () => {
        await clearFirewallForResource(resource, lifecycleContext.timeoutMs, runCommand);
      });
    },

    async onLaunchAfter(ctx) {
      if (config.refreshAfterLaunch === false) return;
      const resource = ctx?.resources?.processFirewall;
      if (!resource?.applied) return;

      const lifecycleContext = resolveFirewallLifecycleContext(ctx, config);
      const applied = await applyFirewallForContext(lifecycleContext, runCommand);
      if (applied.applied) {
        resource.localProxyOnCommand = applied.localProxyOnCommand;
        resource.wanBlockOnCommand = applied.wanBlockOnCommand;
      }
    },

    async onExitAfter(ctx) {
      const timeoutMs = Number(config.commandTimeoutMs ?? 5000);
      await clearFirewallForResource(ctx?.resources?.processFirewall, timeoutMs, runCommand);
    }
  };
}

module.exports = {
  name: `process-firewall`,
  contexts: [`MAIN`],
  priority: 10,

  /** @param {import('@/_core/orchestrators/plugin-orchestrator')} executor */
  async register(executor) {
    const supervisorHooks = executor.hooks?.MAIN?.SUPERVISOR;
    if (!supervisorHooks?.LAUNCH || !supervisorHooks?.EXIT) return;

    const pluginConfig = executor.getPluginConfig?.(this.name) ?? {};
    const lifecycle = createFirewallLifecycle(pluginConfig, {
      runCommand: this.runCommand ?? runLifecycleCommand
    });

    executor.on(supervisorHooks.LAUNCH.BEFORE, (ctx) => lifecycle.onLaunchBefore({
      ...ctx,
      executor
    }), this.pluginMeta);
    executor.on(supervisorHooks.LAUNCH.AFTER, (ctx) => lifecycle.onLaunchAfter({
      ...ctx,
      executor
    }), this.pluginMeta);
    executor.on(supervisorHooks.EXIT.AFTER, (ctx) => lifecycle.onExitAfter({
      ...ctx,
      executor
    }), this.pluginMeta);
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
    normalizePortList,
    resolveLocalProxyOnCommand,
    resolveLocalProxyOffCommand,
    resolveWanBlockOnCommand,
    resolveWanBlockOffCommand,
    tryBuildBridgeRequest,
    runLifecycleCommand,
    resolveFirewallLifecycleContext,
    createFirewallLifecycle
  }
};

Object.freeze(module.exports);
