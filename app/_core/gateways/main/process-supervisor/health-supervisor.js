// _core/gateways/main/process-supervisor/health-supervisor.js


'use strict';


/** Supervisor helper that tracks heartbeats, process health, and reload decisions. */
class HealthSupervisor {
  /** @type {import('./process-supervisor')} */
  processSupervisor;
  plugin;

  /** @type {Map<string, NodeJS.Timeout>} */
  heartbeatTimeoutByLabel;
  /** @type {Map<string, any>} */
  heartbeatHealthByLabel;
  /** @type {Set<string>} */
  reloadingLabels;

  heartbeatTimeoutMs;
  heartbeatMaxElu;
  heartbeatMaxLagP99Ms;
  heartbeatMaxLagMaxMs;
  reloadGracefulExitTimeoutMs;
  reloadForceKillFailSafeTimeoutMs;
  reloadDrainTimeoutMs;

  /** Initializes heartbeat state and health thresholds for supervised child processes. */
  constructor(processSupervisor) {
    this.processSupervisor = processSupervisor;
    this.plugin = this.processSupervisor.plugin;

    this.heartbeatTimeoutByLabel = new Map();
    this.heartbeatHealthByLabel = new Map();
    this.reloadingLabels = new Set();

    const heartbeatConfig = this.processSupervisor.config.heartbeat;
    this.heartbeatTimeoutMs = heartbeatConfig.timeoutMs ?? this.processSupervisor.config.defaultTimeout ?? 30_000;
    this.heartbeatMaxElu = heartbeatConfig.maxElu ?? 0.98;
    this.heartbeatMaxLagP99Ms = heartbeatConfig.maxLagP99Ms ?? 500;
    this.heartbeatMaxLagMaxMs = heartbeatConfig.maxLagMaxMs ?? 1_500;
    this.reloadDrainTimeoutMs = this.processSupervisor.config.reloadDrainTimeoutMs ?? 1_000;
    this.reloadGracefulExitTimeoutMs = this.processSupervisor.config.reloadGracefulExitTimeoutMs ?? 1_500;
    this.reloadForceKillFailSafeTimeoutMs = this.processSupervisor.config.reloadForceKillFailSafeTimeoutMs ?? 1_000;
  }

  /** Starts heartbeat timeout tracking for a newly launched child process. */
  onProcessLaunch(label) {
    this.resetHeartbeatTimeout(label);
  }

  /** Clears transient supervisor state for a child that never completed launch. */
  discardProcessState(label) {
    this.clearHeartbeatTimeout(label);
    this.heartbeatHealthByLabel.delete(label);
    this.reloadingLabels.delete(label);
  }

  /** Clears heartbeat state for a child process that has exited. */
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
    this.clearHeartbeatTimeout(label);
    this.heartbeatHealthByLabel.delete(label);
    if (!terminal) return;

    const crashReason = this.classifyUnexpectedExitReason({ reason, code, signal });
    this.processSupervisor.recordLifecycleEvent({
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
        this.processSupervisor.recordLifecycleEvent({
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

  /** Returns the cached heartbeat health snapshot for one process label. */
  getProcessHealth(label) {
    return this.heartbeatHealthByLabel.get(label) ?? null;
  }

  /** Consumes one heartbeat payload, updates health state, and reloads unhealthy children. */
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

    const managedProcess = this.processSupervisor.children.get(origin);
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
      this.processSupervisor.recordLifecycleEvent({
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

  /** Evaluates heartbeat telemetry against the configured ELU and lag thresholds. */
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

  /** Cancels the active heartbeat timeout for one process label. */
  clearHeartbeatTimeout(label) {
    const timeout = this.heartbeatTimeoutByLabel.get(label);
    if (!timeout) return;
    clearTimeout(timeout);
    this.heartbeatTimeoutByLabel.delete(label);
  }

  /** Arms the heartbeat timeout that marks a child unhealthy when telemetry stops. */
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

  /** Gracefully restarts one managed process and relaunches it after exit. */
  reloadProcess(label, reason = `reload`) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { ERROR, RESTART, SHUTDOWN, CRASH, DEAD } = hooks.MAIN.SUPERVISOR;
    if (this.reloadingLabels.has(label)) return false;

    const managedProcess = this.processSupervisor.children.get(label);
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
    this.processSupervisor.recordLifecycleEvent({
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
        this.processSupervisor.recordLifecycleEvent({
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
        this.reloadingLabels.delete(label); // RELOAD FAILED
        this.clearHeartbeatTimeout(label);
        this.heartbeatHealthByLabel.delete(label);
        this.processSupervisor.recordLifecycleEvent({
          type: `crash`,
          label,
          pid: managedProcess.pid,
          reason: `reload_restart_failed`,
          reloadReason: reason
        });
        this.processSupervisor.recordLifecycleEvent({
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
      this.processSupervisor.recordLifecycleEvent({
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
      try { managedProcess.process.kill(); } catch { }
      forceKillFailSafeTimer = setTimeout(() => {
        if (!this.reloadingLabels.has(label)) return;

        this.reloadingLabels.delete(label);
        this.clearHeartbeatTimeout(label);
        this.heartbeatHealthByLabel.delete(label);
        this.processSupervisor.recordLifecycleEvent({
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
        managedProcess.process.kill();
      }
    } catch {
      this.reloadingLabels.delete(label);
      this.clearHeartbeatTimeout(label);
      this.heartbeatHealthByLabel.delete(label);
      this.processSupervisor.recordLifecycleEvent({
        type: `crash`,
        label,
        pid: managedProcess.pid,
        reason: `send_exit_command_failed`,
        reloadReason: reason
      });
      this.processSupervisor.recordLifecycleEvent({
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
      try { managedProcess.process.kill(); } catch { }
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

  async #relaunchProcess({ label, processOptions, listeners = [] }) {
    const nextProcess = await this.processSupervisor.launchProcess(
      this.#buildFreshProcessOptions(processOptions)
    );
    for (const callback of listeners) nextProcess.on(`stateChange`, callback);
    return nextProcess;
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

module.exports = HealthSupervisor;
Object.freeze(module.exports);
