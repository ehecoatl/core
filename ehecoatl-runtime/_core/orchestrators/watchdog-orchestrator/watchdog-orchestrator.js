// _core/orchestrators/watchdog-orchestrator/watchdog-orchestrator.js


'use strict';

const { requestPrivilegedHostOperation } = require(`@/scripts/privileged-host-bridge`);

/** Main-process orchestrator use case responsible for child heartbeat tracking and reload decisions. */
class WatchdogOrchestrator {
  processForkRuntime;
  plugin;
  rpcRouter;
  routerLabel;

  heartbeatTimeoutByLabel;
  heartbeatHealthByLabel;
  reloadingLabels;

  heartbeatTimeoutMs;
  heartbeatMaxElu;
  heartbeatMaxLagP99Ms;
  heartbeatMaxLagMaxMs;
  reloadGracefulExitTimeoutMs;
  reloadForceKillFailSafeTimeoutMs;
  reloadDrainTimeoutMs;
  heartbeatQuestion;
  reloadProcessQuestion;
  rpcRouterReadyPromise;

  constructor(kernelContext) {
    this.processForkRuntime = kernelContext.useCases?.processForkRuntime ?? kernelContext.useCases?.processOrchestrator ?? null;
    this.plugin = kernelContext.pluginOrchestrator;
    this.rpcRouter = kernelContext.useCases?.rpcRouter ?? null;
    this.routerLabel = this.plugin?.processLabel ?? null;

    this.heartbeatTimeoutByLabel = new Map();
    this.heartbeatHealthByLabel = new Map();
    this.reloadingLabels = new Set();

    const config = kernelContext.config.adapters?.watchdogOrchestrator
      ?? kernelContext.config.watchdogOrchestrator
      ?? {};
    const heartbeatConfig = config.heartbeat ?? {};
    this.heartbeatTimeoutMs = heartbeatConfig.timeoutMs ?? 30_000;
    this.heartbeatMaxElu = heartbeatConfig.maxElu ?? 0.98;
    this.heartbeatMaxLagP99Ms = heartbeatConfig.maxLagP99Ms ?? 500;
    this.heartbeatMaxLagMaxMs = heartbeatConfig.maxLagMaxMs ?? 1_500;
    this.reloadDrainTimeoutMs = config.reloadDrainTimeoutMs ?? 1_000;
    this.reloadGracefulExitTimeoutMs = config.reloadGracefulExitTimeoutMs ?? 1_500;
    this.reloadForceKillFailSafeTimeoutMs = config.reloadForceKillFailSafeTimeoutMs ?? 1_000;
    this.heartbeatQuestion = config.question?.heartbeat ?? `heartbeat`;
    this.reloadProcessQuestion = config.question?.reloadProcess ?? `reloadProcess`;
    this.rpcRouterReadyPromise = Promise.resolve();

    if (this.rpcRouter && this.routerLabel) {
      this.rpcRouterReadyPromise = this.#bindRpcListeners();
    }
  }

  async #bindRpcListeners() {
    this.rpcRouter.endpoint.addListener(this.heartbeatQuestion, (payload) => {
      return this.handleHeartbeat(payload);
    });

    this.rpcRouter.endpoint.addListener(this.reloadProcessQuestion, async ({ label, reason }) => {
      if (!label) return { success: false, skipped: true, reason: `missing_label` };
      const requested = this.reloadProcess(label, reason ?? `reload`);
      return {
        success: requested === true,
        skipped: requested !== true,
        label,
        action: `reload`,
        reason: reason ?? `reload`
      };
    });
  }

  onProcessLaunch(label) {
    this.resetHeartbeatTimeout(label);
  }

  discardProcessState(label) {
    this.clearHeartbeatTimeout(label);
    this.heartbeatHealthByLabel.delete(label);
    this.reloadingLabels.delete(label);
  }

  async onProcessExit(label, {
    terminal = true,
    pid = null,
    reason = null,
    code = null,
    signal = null,
    processOptions = null,
    listeners = []
  } = {}) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { DEAD, ERROR } = hooks.MAIN.SUPERVISOR;
    if (!terminal) return;

    this.clearHeartbeatTimeout(label);
    this.heartbeatHealthByLabel.delete(label);

    const crashReason = this.classifyUnexpectedExitReason({ reason, code, signal });
    this.processForkRuntime.recordLifecycleEvent({
      type: crashReason ? `crash` : `dead`,
      label,
      pid,
      reason: crashReason ?? reason,
      exitCode: code,
      signal
    });
    if (crashReason && processOptions) {
      await plugin.run(hooks.MAIN.SUPERVISOR.CRASH, {
        label,
        pid,
        reason: crashReason,
        exitCode: code,
        signal,
        unexpected: true
      }, ERROR).catch(() => { });

      try {
        const nextProcess = await this.#relaunchProcess({ label, processOptions, listeners });
        this.processForkRuntime.recordLifecycleEvent({
          type: `restart`,
          label,
          pid: nextProcess.pid,
          previousPid: pid,
          reason: crashReason,
          unexpected: true
        });
        await plugin.run(hooks.MAIN.SUPERVISOR.RESTART, {
          label,
          pid: nextProcess.pid,
          previousPid: pid,
          reason: crashReason,
          unexpected: true
        }, ERROR).catch(() => { });
        return;
      } catch (error) {
        await plugin.run(ERROR, {
          label,
          pid,
          reason: `unexpected_exit_restart_failed`,
          crashReason,
          exitCode: code,
          signal,
          error
        }).catch(() => { });
      }
    }

    await plugin.run(DEAD, {
      label,
      pid,
      reason: crashReason ?? reason,
      exitCode: code,
      signal
    }, ERROR).catch(() => { });
  }

  getProcessHealth(label) {
    return this.heartbeatHealthByLabel.get(label) ?? null;
  }

  async handleHeartbeat(payload) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { HEARTBEAT, ERROR } = hooks.MAIN.SUPERVISOR;
    const { origin } = payload;
    if (!origin) {
      await plugin.run(ERROR, {
        reason: `missing_origin`,
        payload
      });
      return { success: false, reason: `missing_origin` };
    }

    const managedProcess = this.processForkRuntime.children.get(origin);
    if (!managedProcess) {
      await plugin.run(ERROR, {
        origin,
        reason: `unknown_origin`,
        payload
      });
      return { success: false, reason: `unknown_origin` };
    }

    this.resetHeartbeatTimeout(origin);
    const health = this.computeHealth(payload);
    const now = Date.now();
    this.heartbeatHealthByLabel.set(origin, {
      ...health,
      observedAt: now,
      payload,
    });
    await plugin.run(HEARTBEAT, {
      origin,
      pid: managedProcess.pid,
      health,
      observedAt: now,
      payload
    }, ERROR);

    if (!health.healthy) {
      this.processForkRuntime.recordLifecycleEvent({
        type: `heartbeat_unhealthy`,
        label: origin,
        pid: managedProcess.pid,
        reason: health.reason
      });
      await plugin.run(ERROR, {
        origin,
        pid: managedProcess.pid,
        reason: `heartbeat_unhealthy`,
        health,
        payload
      });
      this.reloadProcess(origin, `heartbeat_unhealthy`);
      return { success: true, healthy: false, action: `reloading`, reason: health.reason };
    }

    return {
      success: true,
      healthy: true,
      observedAt: now,
      timeoutMs: this.heartbeatTimeoutMs,
    };
  }

  computeHealth(payload) {
    const elu = Number(payload.elu ?? 0);
    const lagP99Ms = Number(payload.lagP99Ms ?? 0);
    const lagMaxMs = Number(payload.lagMaxMs ?? 0);

    const eluLaggy = elu >= this.heartbeatMaxElu;
    const p99Laggy = lagP99Ms >= this.heartbeatMaxLagP99Ms;
    const maxLaggy = lagMaxMs >= this.heartbeatMaxLagMaxMs;
    const healthy = !(eluLaggy || p99Laggy || maxLaggy);

    let reason = null;
    if (eluLaggy) reason = `elu`;
    else if (p99Laggy) reason = `lag_p99`;
    else if (maxLaggy) reason = `lag_max`;

    return {
      healthy,
      reason,
      elu,
      lagP99Ms,
      lagMaxMs,
      limits: {
        maxElu: this.heartbeatMaxElu,
        maxLagP99Ms: this.heartbeatMaxLagP99Ms,
        maxLagMaxMs: this.heartbeatMaxLagMaxMs,
      }
    };
  }

  clearHeartbeatTimeout(label) {
    const timeout = this.heartbeatTimeoutByLabel.get(label);
    if (!timeout) return;
    clearTimeout(timeout);
    this.heartbeatTimeoutByLabel.delete(label);
  }

  resetHeartbeatTimeout(label) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ERROR } = hooks.MAIN.SUPERVISOR;
    this.clearHeartbeatTimeout(label);
    const timeout = setTimeout(() => {
      plugin.run(ERROR, {
        label,
        reason: `heartbeat_timeout`,
      }).catch(() => { });
      this.reloadProcess(label, `heartbeat_timeout`);
    }, this.heartbeatTimeoutMs);
    timeout.unref?.();
    this.heartbeatTimeoutByLabel.set(label, timeout);
  }

  reloadProcess(label, reason = `reload`) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ERROR, RESTART, SHUTDOWN, CRASH, DEAD } = hooks.MAIN.SUPERVISOR;
    if (this.reloadingLabels.has(label)) return false;

    const managedProcess = this.processForkRuntime.children.get(label);
    if (!managedProcess) {
      plugin.run(ERROR, {
        label,
        reason: `reload_unknown_process`,
        reloadReason: reason
      }).catch(() => { });
      return false;
    }

    this.reloadingLabels.add(label);
    this.clearHeartbeatTimeout(label);
    managedProcess.restartOnExit = true;
    managedProcess.exitReason = reason;
    this.processForkRuntime.recordLifecycleEvent({
      type: `reload_requested`,
      label,
      pid: managedProcess.pid,
      reason
    });

    const processOptions = this.#buildFreshProcessOptions({
      label: managedProcess.label,
      path: managedProcess.path,
      cwd: managedProcess.cwd,
      processUser: managedProcess.processUser,
      processGroup: managedProcess.processGroup,
      processSecondGroup: managedProcess.processSecondGroup,
      processThirdGroup: managedProcess.processThirdGroup,
      variables: managedProcess.variables,
      serialization: managedProcess.serialization,
      env: managedProcess.env,
    });
    const listeners = managedProcess.listeners(`stateChange`);

    const relaunch = async () => {
      const nextProcess = await this.#relaunchProcess({ label, processOptions, listeners });
      this.reloadingLabels.delete(label);
      return nextProcess;
    };

    managedProcess.state = `exit`;
    plugin.run(SHUTDOWN, {
      label,
      pid: managedProcess.pid,
      reason
    }, ERROR).catch(() => { });

    let forceKillTimer = null;
    let forceKillFailSafeTimer = null;
    const onExit = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (forceKillFailSafeTimer) clearTimeout(forceKillFailSafeTimer);
      relaunch().then((newManagedProcess) => {
        this.processForkRuntime.recordLifecycleEvent({
          type: `restart`,
          label,
          pid: newManagedProcess.pid,
          previousPid: managedProcess.pid,
          reason
        });
        plugin.run(RESTART, {
          label,
          pid: newManagedProcess.pid,
          reason
        }, ERROR).catch(() => { });
      }).catch((error) => {
        this.reloadingLabels.delete(label);
        this.clearHeartbeatTimeout(label);
        this.heartbeatHealthByLabel.delete(label);
        this.processForkRuntime.recordLifecycleEvent({
          type: `crash`,
          label,
          pid: managedProcess.pid,
          reason: `reload_restart_failed`,
          reloadReason: reason
        });
        this.processForkRuntime.recordLifecycleEvent({
          type: `dead`,
          label,
          pid: managedProcess.pid,
          reason: `reload_failed`,
          reloadReason: reason
        });
        plugin.run(CRASH, {
          label,
          pid: managedProcess.pid,
          reason: `reload_restart_failed`,
          reloadReason: reason,
          error
        }, ERROR).catch(() => { });
        plugin.run(DEAD, {
          label,
          pid: managedProcess.pid,
          reason: `reload_failed`,
          reloadReason: reason
        }, ERROR).catch(() => { });
      });
    };

    managedProcess.process.once(`exit`, onExit);

    forceKillTimer = setTimeout(() => {
      this.processForkRuntime.recordLifecycleEvent({
        type: `crash`,
        label,
        pid: managedProcess.pid,
        reason: `graceful_exit_timeout`,
        reloadReason: reason
      });
      plugin.run(CRASH, {
        label,
        pid: managedProcess.pid,
        reason: `graceful_exit_timeout`,
        reloadReason: reason
      }, ERROR).catch(() => { });
      this.#forceKillManagedProcess(managedProcess, {
        label,
        reason: `graceful_exit_timeout`,
        reloadReason: reason
      })
        .catch((error) => {
          plugin.run(CRASH, {
            label,
            pid: managedProcess.pid,
            reason: `force_kill_failed`,
            reloadReason: reason,
            error
          }, ERROR).catch(() => { });
        })
        .finally(() => {
          forceKillFailSafeTimer = setTimeout(() => {
            if (!this.reloadingLabels.has(label)) return;

            this.reloadingLabels.delete(label);
            this.clearHeartbeatTimeout(label);
            this.heartbeatHealthByLabel.delete(label);
            this.processForkRuntime.recordLifecycleEvent({
              type: `dead`,
              label,
              pid: managedProcess.pid,
              reason: `reload_force_kill_no_exit`,
              reloadReason: reason
            });
            plugin.run(DEAD, {
              label,
              pid: managedProcess.pid,
              reason: `reload_force_kill_no_exit`,
              reloadReason: reason
            }, ERROR).catch(() => { });
          }, this.reloadForceKillFailSafeTimeoutMs);
          forceKillFailSafeTimer.unref?.();
        });
    }, this.reloadGracefulExitTimeoutMs);
    forceKillTimer.unref?.();

    try {
      if (typeof managedProcess.process.send === `function`) {
        managedProcess.process.send({
          __supervisorCommand: `drain`,
          code: 1,
          reason,
          timeoutMs: this.reloadDrainTimeoutMs
        });
      } else {
        this.#forceKillManagedProcess(managedProcess, {
          label,
          reason: `missing_ipc_send`,
          reloadReason: reason
        }).catch((error) => {
          plugin.run(CRASH, {
            label,
            pid: managedProcess.pid,
            reason: `force_kill_failed`,
            reloadReason: reason,
            error
          }, ERROR).catch(() => { });
        });
      }
    } catch {
      this.reloadingLabels.delete(label);
      this.clearHeartbeatTimeout(label);
      this.heartbeatHealthByLabel.delete(label);
      this.processForkRuntime.recordLifecycleEvent({
        type: `crash`,
        label,
        pid: managedProcess.pid,
        reason: `send_exit_command_failed`,
        reloadReason: reason
      });
      this.processForkRuntime.recordLifecycleEvent({
        type: `dead`,
        label,
        pid: managedProcess.pid,
        reason: `reload_failed`,
        reloadReason: reason
      });
      plugin.run(CRASH, {
        label,
        pid: managedProcess.pid,
        reason: `send_exit_command_failed`,
        reloadReason: reason
      }, ERROR).catch(() => { });
      plugin.run(DEAD, {
        label,
        pid: managedProcess.pid,
        reason: `reload_failed`,
        reloadReason: reason
      }, ERROR).catch(() => { });
      this.#forceKillManagedProcess(managedProcess, {
        label,
        reason: `send_exit_command_failed`,
        reloadReason: reason
      }).catch((error) => {
        plugin.run(CRASH, {
          label,
          pid: managedProcess.pid,
          reason: `force_kill_failed`,
          reloadReason: reason,
          error
        }, ERROR).catch(() => { });
      });
    }

    return true;
  }

  classifyUnexpectedExitReason({ reason = null, code = null, signal = null } = {}) {
    if (reason === `shutdown` || reason === `destroy` || reason === `signal`) return null;
    if (reason === `reload` || reason === `restart`) return `unexpected_exit`;
    if (reason && ![`shutdown`, `destroy`].includes(reason)) return reason;
    if (signal) return `unexpected_signal_exit`;
    if (Number.isInteger(code) && code !== 0) return `unexpected_exit`;
    return null;
  }

  async #relaunchProcess({ processOptions, listeners = [] }) {
    const nextProcess = await this.processForkRuntime.launchProcess(
      this.#buildFreshProcessOptions(processOptions)
    );
    for (const callback of listeners) nextProcess.on(`stateChange`, callback);
    return nextProcess;
  }

  async #forceKillManagedProcess(managedProcess, {
    label = null,
    reason = `force_kill`,
    reloadReason = null
  } = {}) {
    const pid = managedProcess?.pid ?? null;
    if (!pid || !managedProcess?.process) {
      const error = new Error(`Cannot force-kill managed process without a pid`);
      error.code = `MISSING_MANAGED_PROCESS_PID`;
      throw error;
    }

    try {
      managedProcess.process.kill(`SIGKILL`);
      return {
        pid,
        method: `direct`,
        signal: `SIGKILL`
      };
    } catch (error) {
      if (error?.code === `ESRCH`) {
        return {
          pid,
          method: `already_exited`,
          signal: `SIGKILL`
        };
      }
      if (![ `EPERM`, `EACCES` ].includes(error?.code)) throw error;
    }

    const result = await requestPrivilegedHostOperation({
      operation: `process.kill`,
      payload: {
        pid,
        signal: `SIGKILL`,
        expectedLabel: label,
        reason,
        reloadReason
      },
      timeoutMs: Math.max(500, this.reloadForceKillFailSafeTimeoutMs)
    });
    return {
      pid,
      method: `privileged`,
      signal: `SIGKILL`,
      result
    };
  }

  #buildFreshProcessOptions(processOptions = {}) {
    return {
      ...processOptions,
      env: { ...(processOptions.env ?? {}) },
      variables: Array.isArray(processOptions.variables) ? [...processOptions.variables] : [],
      resources: {},
      cleanupTasks: [],
    };
  }
}

module.exports = WatchdogOrchestrator;
Object.freeze(module.exports);
