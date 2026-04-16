// _core/gateways/main/process-supervisor/process-supervisor.js


'use strict';

const ManagedProcess = require("./managed-process");
const HealthSupervisor = require(`./health-supervisor`);
const GatewayCore = require(`g@/gateway-core`);
const { resolveProcessUser } = require(`@/config/runtime-policy`);

/** Main-process gateway responsible for spawning, routing, and supervising child processes. */
class ProcessSupervisor extends GatewayCore {
  /** @type {Map<string, ManagedProcess>} */
  children;
  /** @type {Map<number, string>} */
  labelsByPid;
  /** @type {HealthSupervisor} */
  healthSupervisor;
  lifecycleHistory;
  lifecycleHistoryMax;

  /** @type {import('g@/index').RpcRouter}  */
  rpcRouter;
  routerLabel;

  /** @type {typeof import('@/config/default.config').processSupervisor} */
  config;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./process-supervisor-adapter')} */
  adapter = null;
  rpcRouterReadyPromise;
  queueCleanupQuestion;
  reloadProcessQuestion;
  shutdownProcessQuestion;
  ensureProcessQuestion;
  listProcessesQuestion;
  processCountsQuestion;

  /** Initializes process supervision state, health tracking, and RPC router bindings. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.processSupervisor);
    this.config = kernelContext.config.processSupervisor;
    this.plugin = kernelContext.plugin;
    this.children = new Map(); // label -> ManagedProcess
    this.labelsByPid = new Map(); // pid -> label
    this.healthSupervisor = new HealthSupervisor(this);
    this.lifecycleHistory = [];
    this.lifecycleHistoryMax = this.config.lifecycleHistoryMax ?? 200;
    this.rpcRouterReadyPromise = Promise.resolve();
    this.queueCleanupQuestion = kernelContext.config.requestPipeline?.question?.cleanupByOrigin ?? `queueCleanupByOrigin`;
    this.reloadProcessQuestion = this.config.question?.reloadProcess ?? `reloadProcess`;
    this.shutdownProcessQuestion = this.config.question?.shutdownProcess ?? `shutdownProcess`;
    this.ensureProcessQuestion = this.config.question?.ensureProcess ?? `ensureProcess`;
    this.listProcessesQuestion = this.config.question?.listProcesses ?? `listProcesses`;
    this.processCountsQuestion = this.config.question?.processCounts ?? `processCounts`;

    const rpcRouter = kernelContext.gateways?.rpcRouter ?? null;
    const routerLabel = this.plugin.processLabel ?? null;
    if (rpcRouter && routerLabel) {
      this.rpcRouterReadyPromise = this.#setRpcRouter({ routerLabel, rpcRouter });
    }
  }

  /** Connects the supervisor to the shared RPC router and installs supervisor listeners. */
  async #setRpcRouter({ routerLabel, rpcRouter }) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { BOOTSTRAP, ERROR } = hooks.MAIN.SUPERVISOR;
    this.rpcRouter = rpcRouter;
    this.routerLabel = routerLabel;
    this.rpcRouter.registerTarget(routerLabel, this.currentProcess);
    await plugin.run(BOOTSTRAP, {
      routerLabel,
      process: this.currentProcess
    }, ERROR).catch(() => { });

    // LISTEN TO STATE CHANGES
    this.rpcRouter.endpoint.addListener(`state`, async ({ origin, state, ...details }) => {
      const managedProcess = this.children.get(origin);
      if (!managedProcess) return { success: false };
      managedProcess.state = state;
      this.recordLifecycleEvent({
        type: `state`,
        label: origin,
        pid: managedProcess.pid,
        state,
        ...details
      });

      const stateHookMap = {
        ready: hooks.MAIN.SUPERVISOR.READY,
        shutdown: hooks.MAIN.SUPERVISOR.SHUTDOWN,
        crash: hooks.MAIN.SUPERVISOR.CRASH,
      };
      const hookId = stateHookMap[state] ?? null;
      if (Number.isInteger(hookId)) {
        plugin.run(hookId, {
          label: origin,
          pid: managedProcess.pid,
          state,
          ...details
        }, hooks.MAIN.SUPERVISOR.ERROR).catch(() => { });
      }

      return { success: true };
    });

    //LISTEN TO CHILDREN HEARTBEAT
    this.rpcRouter.endpoint.addListener(`heartbeat`, (payload) => {
      return this.healthSupervisor.handleHeartbeat(payload);
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

    this.rpcRouter.endpoint.addListener(this.shutdownProcessQuestion, async ({ label, reason, timeoutMs }) => {
      if (!label) return { success: false, skipped: true, reason: `missing_label` };
      const managedProcess = this.getProcessByLabel(label);
      if (!managedProcess) {
        return {
          success: false,
          skipped: true,
          label,
          action: `shutdown`,
          reason: reason ?? `shutdown`,
          missing: true
        };
      }

      const success = await this.shutdownProcess(
        label,
        reason ?? `shutdown`,
        timeoutMs ?? this.config.defaultTimeout ?? 30_000
      );
      return {
        success,
        skipped: false,
        label,
        action: `shutdown`,
        reason: reason ?? `shutdown`
      };
    });

    this.rpcRouter.endpoint.addListener(this.ensureProcessQuestion, async ({
      label,
      reason,
      processType,
      tenantHost,
      tenantRoot
    }) => {
      return this.ensureProcess({
        label,
        reason,
        processType,
        tenantHost,
        tenantRoot
      });
    });

    this.rpcRouter.endpoint.addListener(this.listProcessesQuestion, async () => {
      return {
        success: true,
        processes: this.listProcesses()
      };
    });

    this.rpcRouter.endpoint.addListener(this.processCountsQuestion, async () => {
      return {
        success: true,
        counts: this.getProcessCountsSnapshot()
      };
    });
  }

  /** Returns the current process handle through the active supervision adapter. */
  get currentProcess() {
    super.loadAdapter();
    return this.adapter.currentProcessAdapter();
  }

  /** Spawns a managed child process, runs launch hooks, and registers its routing lifecycle.
   * @param {{label, path, cwd, processUser, variables, serialization, env}} processOptions
  */
  async launchProcess(processOptions) {
    super.loadAdapter();
    await this.#waitUntilSupervisorReady();
    const launchContext = await this.#runLaunchBeforeHook(processOptions);
    let managedProcess;

    try {
      managedProcess = new ManagedProcess(
        this.adapter.spawnAdapter,
        launchContext.processOptions
      );
    } catch (error) {
      await this.#runLaunchErrorHook(launchContext, error);
      await this.#runCleanupTasks(launchContext.cleanupTasks);
      throw error;
    }
    const { pid, label } = managedProcess;

    const onExitCallback = async (code = null, signal = null) => {
      const exitContext = {
        code,
        signal,
        label,
        pid,
        processCountsBeforeExit: this.getProcessCountsSnapshot(),
        managedProcess,
        process: managedProcess.process,
        processOptions: {
          label: managedProcess.label,
          path: managedProcess.path,
          cwd: managedProcess.cwd,
          processUser: managedProcess.processUser,
          variables: managedProcess.variables,
          serialization: managedProcess.serialization,
          env: managedProcess.env,
          resources: managedProcess.resources,
          cleanupTasks: managedProcess.cleanupTasks,
        },
        resources: managedProcess.resources,
        cleanupTasks: managedProcess.cleanupTasks,
        reason: managedProcess.exitReason ?? null,
        restartOnExit: managedProcess.restartOnExit === true,
      };

      let exitError = null;

      try {
        await this.#runExitHook(`BEFORE`, exitContext);
      } catch (error) {
        exitError = error;
      }

      this.children.delete(label);
      this.labelsByPid.delete(pid);
      this.rpcRouter.unregisterTarget(label);
      exitContext.processCountsAfterExit = this.getProcessCountsSnapshot();

      try {
        await this.#runCleanupTasks(managedProcess.cleanupTasks);
        await this.#runExitHook(`AFTER`, exitContext);
      } catch (error) {
        exitError ??= error;
      }

      await this.cleanupManagerQueueTasksForProcess(label).catch(() => { });

      try {
        if (exitError) {
          await this.#runExitErrorHook(exitContext, exitError);
        }

        await this.healthSupervisor.onProcessExit(label, {
          terminal: managedProcess.restartOnExit !== true,
          pid,
          reason: managedProcess.exitReason ?? null,
          code,
          signal,
          processOptions: exitContext.processOptions,
          listeners: managedProcess.listeners(`stateChange`)
        });
      } finally {
        managedProcess.resolveExitTeardown?.();
      }
    };

    const onMessageToRootCallback = async (payload) => {
      // ensure origin is set so replies can be routed
      if (!payload.origin) payload.origin = label;

      const targetEndpointLabel = payload.target ?? null;

      // Requests for the root process stay local, handled by the supervisor;
      // others are forwarded by label
      if (targetEndpointLabel === this.routerLabel)
        this.rpcRouter.endpoint.onReceive(payload);
      else
        this.rpcRouter.routeTo(targetEndpointLabel, payload);
    };

    try {
      this.adapter.initAdapter({ managedProcess, onMessageToRootCallback, onExitCallback });
      this.children.set(label, managedProcess);
      this.labelsByPid.set(pid, label);
      this.rpcRouter.registerTarget(label, managedProcess.process);
      this.healthSupervisor.onProcessLaunch(label);
      this.recordLifecycleEvent({
        type: `launch`,
        label,
        pid,
        path: managedProcess.path
      });
      await this.#runLaunchAfterHook(managedProcess, launchContext);
    } catch (error) {
      await this.#rollbackFailedLaunch({
        managedProcess,
        launchContext,
        error,
        onMessageToRootCallback,
        onExitCallback
      });
      throw error;
    }
    return managedProcess;
  }

  /** Resolves a managed child instance from its pid. */
  getProcessByPid(pid) {
    const label = this.labelsByPid.get(pid);
    if (!label) return undefined;
    return this.children.get(label);
  }

  /** Resolves a managed child instance from its logical process label. */
  getProcessByLabel(label) {
    return this.children.get(label);
  }

  /** Returns the latest cached health snapshot for a managed child. */
  getProcessHealth(label) {
    return this.healthSupervisor.getProcessHealth(label);
  }

  /** Stores a bounded lifecycle event history for runtime inspection and auditing. */
  recordLifecycleEvent(event) {
    const entry = Object.freeze({
      at: new Date().toISOString(),
      ...event
    });
    this.lifecycleHistory.push(entry);
    if (this.lifecycleHistory.length > this.lifecycleHistoryMax) {
      this.lifecycleHistory.splice(0, this.lifecycleHistory.length - this.lifecycleHistoryMax);
    }
    return entry;
  }

  /** Returns recent lifecycle events, optionally filtered to one process label. */
  getLifecycleHistory(label = null) {
    if (!label) return [...this.lifecycleHistory];
    return this.lifecycleHistory.filter((entry) => entry.label === label);
  }

  /** Requests a health-supervised reload cycle for one managed child process. */
  reloadProcess(label, reason = `reload`) {
    return this.healthSupervisor.reloadProcess(label, reason);
  }

  /** Ensures one managed process exists, launching it only when missing. */
  async ensureProcess({
    label,
    reason = `ensure`,
    processType = null,
    tenantHost = null,
    tenantRoot = null
  }) {
    if (!label) return { success: false, skipped: true, reason: `missing_label` };

    const existing = this.getProcessByLabel(label);
    if (existing) {
      return {
        success: true,
        skipped: true,
        existing: true,
        label,
        reason
      };
    }

    if (processType === `tenantApp`) {
      const tenantAppConfig = this.config.tenantApp ?? {};
      await this.launchProcess({
        label,
        path: tenantAppConfig.path,
        processUser: resolveProcessUser(label),
        variables: [tenantHost, tenantRoot, label],
        cwd: process.cwd(),
        serialization: `advanced`,
        env: { ...process.env }
      });
      return {
        success: true,
        skipped: false,
        existing: false,
        label,
        reason
      };
    }

    return {
      success: false,
      skipped: true,
      reason: `unsupported_process_type`,
      label,
      processType
    };
  }

  /** Lists managed children with current pid/state for runtime reconciliation. */
  listProcesses() {
    return [...this.children.values()].map((managedProcess) => ({
      label: managedProcess.label,
      pid: managedProcess.pid,
      state: managedProcess.state ?? null
    }));
  }

  /** Returns child-process counts grouped by process label family for operational visibility. */
  getProcessCountsSnapshot() {
    const counts = {
      total: this.children.size,
      manager: 0,
      engine: 0,
      tenant: 0,
      other: 0
    };

    for (const label of this.children.keys()) {
      if (label === `manager`) counts.manager += 1;
      else if (label.startsWith(`engine_`)) counts.engine += 1;
      else if (label.startsWith(`tenant_`)) counts.tenant += 1;
      else counts.other += 1;
    }

    return counts;
  }

  /** Requests one supervised child to exit and waits briefly for its process handle to terminate. */
  async shutdownProcess(label, reason = `shutdown`, timeoutMs = this.config.defaultTimeout ?? 30_000) {
    const managedProcess = this.children.get(label);
    if (!managedProcess?.process) return false;
    managedProcess.restartOnExit = false;
    managedProcess.exitReason = reason;

    return await new Promise((resolve) => {
      let settled = false;
      let timer = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        managedProcess.process.off(`exit`, onExit);
        resolve(value);
      };

      const onExit = () => {
        managedProcess.exitTeardownPromise
          .then(() => finish(true))
          .catch(() => finish(false));
      };
      managedProcess.process.once(`exit`, onExit);

      timer = setTimeout(() => {
        try { managedProcess.process.kill(); } catch { }
        finish(false);
      }, timeoutMs);
      timer.unref?.();

      try {
        if (typeof managedProcess.process.send === `function`) {
          managedProcess.process.send({
            __supervisorCommand: `drain`,
            code: 0,
            reason,
            timeoutMs
          });
        } else {
          managedProcess.process.kill();
        }
      } catch {
        try { managedProcess.process.kill(); } catch { }
        finish(false);
      }
    });
  }

  /** Requests an orderly shutdown for every supervised child process and waits for completion. */
  async shutdownAllChildren(reason = `shutdown`) {
    const labels = [...this.children.keys()];
    const results = await Promise.allSettled(
      labels.map((label) => this.shutdownProcess(label, reason))
    );

    return {
      success: results.every((result) => result.status === `fulfilled` && result.value === true),
      total: labels.length,
      results
    };
  }

  /** Shuts down all children before delegating to adapter teardown. */
  async destroy() {
    await this.shutdownAllChildren(`destroy`);
    await super.destroy();
  }

  /** Asks the manager process to release orphaned queue tasks owned by one exited engine process. */
  async cleanupManagerQueueTasksForProcess(label) {
    if (!this.rpcRouter?.endpoint || !label?.startsWith(`engine_`)) {
      return { success: false, skipped: true, label };
    }

    try {
      return await this.rpcRouter.endpoint.ask({
        target: `manager`,
        question: this.queueCleanupQuestion,
        data: { origin: label }
      });
    } catch {
      return { success: false, skipped: false, label };
    }
  }

  async #runLaunchBeforeHook(processOptions) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const launchHooks = hooks.MAIN.SUPERVISOR.LAUNCH;
    const launchContext = {
      label: processOptions.label ?? null,
      processCountsBeforeLaunch: this.getProcessCountsSnapshot(),
      processOptions: {
        ...processOptions,
        env: { ...(processOptions.env ?? {}) },
        resources: processOptions.resources ?? {},
        cleanupTasks: Array.isArray(processOptions.cleanupTasks) ? [...processOptions.cleanupTasks] : [],
      },
      resources: processOptions.resources ?? {},
      cleanupTasks: Array.isArray(processOptions.cleanupTasks) ? [...processOptions.cleanupTasks] : [],
    };

    const nextContext = await plugin.runWithContext(launchHooks.BEFORE, launchContext, {
      errHook: launchHooks.ERROR,
      rethrow: true
    });
    nextContext.processOptions.resources = nextContext.resources ?? {};
    nextContext.processOptions.cleanupTasks = Array.isArray(nextContext.cleanupTasks)
      ? nextContext.cleanupTasks
      : [];
    return nextContext;
  }

  async #waitUntilSupervisorReady() {
    await this.rpcRouterReadyPromise;
    if (!this.rpcRouter || !this.routerLabel) {
      throw new Error(`ProcessSupervisor RPC router is not ready`);
    }
  }

  async #runLaunchAfterHook(managedProcess, launchContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const launchHooks = hooks.MAIN.SUPERVISOR.LAUNCH;

    return await plugin.run(launchHooks.AFTER, {
      label: managedProcess.label,
      pid: managedProcess.pid,
      processCounts: this.getProcessCountsSnapshot(),
      processCountsBeforeLaunch: launchContext.processCountsBeforeLaunch,
      managedProcess,
      process: managedProcess.process,
      processOptions: launchContext.processOptions,
      resources: managedProcess.resources,
      cleanupTasks: managedProcess.cleanupTasks,
    }, launchHooks.ERROR);
  }

  async #runLaunchErrorHook(launchContext, error) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const launchHooks = hooks.MAIN.SUPERVISOR.LAUNCH;

    return await plugin.run(launchHooks.ERROR, {
      ...launchContext,
      processCounts: this.getProcessCountsSnapshot(),
      error
    }, hooks.MAIN.SUPERVISOR.ERROR);
  }

  async #runExitHook(phase, exitContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const exitHooks = hooks.MAIN.SUPERVISOR.EXIT;
    const hookId = exitHooks?.[phase] ?? null;
    if (!Number.isInteger(hookId)) return;
    await plugin.run(hookId, exitContext, exitHooks.ERROR);
  }

  async #runExitErrorHook(exitContext, error) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const exitHooks = hooks.MAIN.SUPERVISOR.EXIT;
    await plugin.run(exitHooks.ERROR, {
      ...exitContext,
      error
    }, hooks.MAIN.SUPERVISOR.ERROR);
  }

  async #runCleanupTasks(cleanupTasks = []) {
    for (const task of cleanupTasks) {
      if (typeof task !== `function`) continue;
      await task();
    }
  }

  async #rollbackFailedLaunch({
    managedProcess,
    launchContext,
    error,
    onMessageToRootCallback,
    onExitCallback
  }) {
    const { label, pid } = managedProcess;

    try {
      managedProcess.process?.off?.(`message`, onMessageToRootCallback);
      managedProcess.process?.off?.(`exit`, onExitCallback);
    } catch { }

    this.children.delete(label);
    this.labelsByPid.delete(pid);
    this.rpcRouter?.unregisterTarget?.(label);
    this.healthSupervisor.discardProcessState(label);

    try {
      managedProcess.restartOnExit = false;
      managedProcess.exitReason = `launch_failed`;
      managedProcess.process?.kill?.();
    } catch { }

    await this.#runLaunchErrorHook({
      ...launchContext,
      label,
      pid,
      managedProcess,
      process: managedProcess.process
    }, error);
    await this.#runCleanupTasks(managedProcess.cleanupTasks);
  }

}

module.exports = ProcessSupervisor;
Object.freeze(module.exports);
