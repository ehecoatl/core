// _core/boot/boot-resolver.js


'use strict';


const PluginExecutor = require(`./plugin-executor`);

/** Centralizes process exit, signal, and shutdown hook handling during bootstrap lifecycle. */
class BootResolver {
  static #listenersBound = false;
  /** @type {PluginExecutor} */
  static #plugin = null;
  static #processHooks = null;
  static #shutdownTasks = [];
  static #shutdownRunning = false;
  static #stateReporter = null;
  static #reportedStates = new Set();
  static #drainHandler = null;

  /** Logs a formatted fatal/error line during bootstrap and shutdown handling. */
  static async #error(msg) {
    return console.error(`\x1b[41m [${new Date().toISOString()}] > ${msg} \x1b[0m`, `white`, `red`);
  }

  /** Logs a formatted lifecycle line during bootstrap and shutdown handling. */
  static async #log(msg) {
    return console.log(`\x1b[41m [${new Date().toISOString()}] > ${msg} \x1b[0m`, `white`, `red`);
  }

  /** Reports a fatal runtime error and exits the current process after a short flush delay. */
  static async #fatalErrorExit(e, message, code = 0) {
    await this.#runShutdownTasks({
      source: `fatal_error`,
      code
    });
    this.#error(`[FATAL ERROR]`);
    this.#error(message);

    console.error(e);
    console.error(`\n\n`);

    this.#error(`EXIT CODE ${code} `);
    this.#error(code === 0 ? `Shutting down process.` : `Restarting process.`);
    await new Promise((r) => setTimeout(r, 500));
    process.exit(code); // exit the process after an uncaught exception DURING COMPOSING
  }

  /** Runs registered shutdown tasks only once before the current process exits. */
  static async #runShutdownTasks(payload = {}) {
    if (this.#shutdownRunning) return;
    this.#shutdownRunning = true;

    for (const { task } of this.#shutdownTasks) {
      try {
        await task(payload);
      } catch { }
    }
  }

  /** Dispatches one process-scoped hook with standard process metadata attached. */
  static #runProcessHook(hookId, payload = {}) {
    const errorHookId = this.#processHooks?.ERROR;
    if (!this.#plugin || !Number.isInteger(hookId)) return;
    return this.#plugin.run(hookId, {
      pid: process.pid,
      ...payload
    }, hookId === errorHookId ? null : errorHookId).catch(() => { });
  }

  /** Resolves a named process lifecycle hook and dispatches it if configured. */
  static #runHookByName(hookName, payload = {}) {
    const processHooks = this.#processHooks;
    if (!processHooks) return;
    return this.#runProcessHook(processHooks[hookName], payload);
  }

  /** Registers one async task to be awaited during coordinated process shutdown. */
  static registerShutdownTask(task, priority = 0) {
    if (typeof task !== `function`) return;
    this.#shutdownTasks.push({ task, priority });
    this.#shutdownTasks.sort((a, b) => a.priority - b.priority);
  }

  /** Registers a child-state reporter used to publish shutdown and crash states to the supervisor. */
  static registerStateReporter(reporter) {
    if (typeof reporter !== `function`) return;
    this.#stateReporter = reporter;
  }

  /** Registers a drain callback used to block shutdown until in-flight work settles. */
  static registerDrainHandler(handler) {
    if (typeof handler !== `function`) return;
    this.#drainHandler = handler;
  }

  /** Publishes a child lifecycle state once per state type during shutdown or crash handling. */
  static async #reportState(state, payload = {}) {
    if (!this.#stateReporter || this.#reportedStates.has(state)) return;
    this.#reportedStates.add(state);
    await this.#stateReporter(state, sanitizeStatePayload(payload)).catch(() => { });
  }

  /** Binds process listeners for signals, supervisor commands, and fatal runtime failures. */
  static setupExitHandlers(plugin = null, processHooks = null) {
    if (plugin) this.#plugin = plugin;
    if (processHooks) this.#processHooks = processHooks;

    if (this.#listenersBound) return;
    this.#listenersBound = true;

    process.on(`message`,
      /** @param {*} message */
      async (message) => {
        if (!message || typeof message !== `object`) return;
        const { __supervisorCommand, code } = message;
        switch (__supervisorCommand) {
          case `exit`:
            await this.#runSupervisorExitCommand({
              source: `supervisor_command`,
              code,
              reason: message?.reason ?? null
            });
            break;
          case `drain`:
            await this.#runSupervisorExitCommand({
              source: `supervisor_drain`,
              code,
              reason: message?.reason ?? null,
              timeoutMs: message?.timeoutMs,
              draining: true
            });
            break;
        }
      }
    );

    process.on(`disconnect`, async () => {
      await this.#reportState(`shutdown`, {
        source: `disconnect`,
        code: 0
      });
      await this.#runHookByName(`SHUTDOWN`, {
        source: `disconnect`,
        code: 0
      });
      await this.#runShutdownTasks({
        source: `disconnect`,
        code: 0
      });
      this.#log(`CAUGHT BY: IPC DISCONNECT`);
      this.#log(`Parent process disconnected. Exiting child process...`);
      this.#log(`EXIT CODE 0 `);
      await new Promise((r) => setTimeout(r, 100));
      process.exit(0);
    });

    process.on(`SIGINT`, async () => {
      await this.#reportState(`shutdown`, {
        source: `signal`,
        signal: `SIGINT`,
        code: 0
      });
      await this.#runHookByName(`SHUTDOWN`, {
        source: `signal`,
        signal: `SIGINT`
      });
      await this.#runShutdownTasks({
        source: `signal`,
        signal: `SIGINT`,
        code: 0
      });
      this.#log(`CAUGHT BY: `);
      this.#log(`SIGINT received. Exiting...`);
      this.#log(`EXIT CODE 0 `);
      await new Promise((r) => setTimeout(r, 500));
      process.exit(0);
    });

    process.on(`SIGTERM`, async () => {
      await this.#reportState(`shutdown`, {
        source: `signal`,
        signal: `SIGTERM`,
        code: 0
      });
      await this.#runHookByName(`SHUTDOWN`, {
        source: `signal`,
        signal: `SIGTERM`
      });
      await this.#runShutdownTasks({
        source: `signal`,
        signal: `SIGTERM`,
        code: 0
      });
      this.#log(`CAUGHT BY: `);
      this.#log(`SIGTERM received. Exiting...`);
      this.#log(`EXIT CODE 0 `);
      await new Promise((r) => setTimeout(r, 500));
      process.exit(0);
    });

    process.on(`beforeExit`, async (code) => {
      await this.#reportState(`shutdown`, {
        source: `beforeExit`,
        code
      });
      await this.#runHookByName(`SHUTDOWN`, {
        source: `beforeExit`,
        code
      });
      await this.#runShutdownTasks({
        source: `beforeExit`,
        code
      });
    });

    // NOTE: `exit` event is sync-only; async hook execution may not flush.
    process.on(`exit`, (code) => {
      this.#runHookByName(`DEAD`, {
        source: `exit`,
        code
      });
    });

    process.on(`uncaughtException`, (err) => {
      this.#reportState(`crash`, {
        source: `uncaughtException`,
        code: 1,
        error: err
      });
      this.#runHookByName(`ERROR`, {
        source: `uncaughtException`,
        error: err
      });
      this.#runHookByName(`CRASH`, {
        source: `uncaughtException`,
        error: err
      });
      this.#fatalErrorExit(
        err,
        `CAUGHT BY: Uncaught Exception`,
        1, //App Restart
      );
    });

    process.on(`unhandledRejection`, (reason, promise) => {
      this.#reportState(`crash`, {
        source: `unhandledRejection`,
        code: 1,
        reason
      });
      this.#runHookByName(`ERROR`, {
        source: `unhandledRejection`,
        reason,
        promise
      });
      this.#runHookByName(`CRASH`, {
        source: `unhandledRejection`,
        reason,
        promise
      });
      this.#fatalErrorExit(
        reason instanceof Error ? reason : new Error(`Unhandled Rejection: ${String(reason)}`),
        `CAUGHT BY: Unhandled Rejection`,
        1, //App Restart
      );
    });

    process.on(`warning`, (warning) => {
      this.#runHookByName(`ERROR`, {
        source: `warning`,
        warning
      });
    });
  }

  /** Executes one supervisor-driven graceful shutdown command with optional in-flight draining. */
  static async #runSupervisorExitCommand({
    source,
    code,
    reason = null,
    timeoutMs = null,
    draining = false
  }) {
    const numCode = Number.isInteger(code) ? code : 1;
    if (draining && typeof this.#drainHandler === `function`) {
      await this.#runDrainHandler({
        source,
        code: numCode,
        reason,
        timeoutMs
      });
    }

    await this.#reportState(`shutdown`, {
      source,
      code: numCode,
      reason,
      draining: draining || null
    });
    await this.#runHookByName(`SHUTDOWN`, {
      source,
      code: numCode,
      reason,
      draining: draining || null
    });
    await this.#runShutdownTasks({
      source,
      code: numCode,
      reason,
      draining: draining || null
    });
    this.#log(`CAUGHT BY: SUPERVISOR COMMAND`);
    this.#log(`Exiting child process with code ${numCode}.`);
    await new Promise((r) => setTimeout(r, 100));
    process.exit(numCode);
  }

  /** Runs the registered drain callback with a hard timeout to avoid hanging shutdown forever. */
  static async #runDrainHandler({
    source,
    code,
    reason,
    timeoutMs
  }) {
    const drainTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : 1_000;

    await Promise.race([
      Promise.resolve().then(() => this.#drainHandler({
        source,
        code,
        reason,
        timeoutMs: drainTimeoutMs
      })),
      new Promise((resolve) => {
        const timeout = setTimeout(resolve, drainTimeoutMs);
        timeout.unref?.();
      })
    ]).catch(() => { });
  }

}

function sanitizeStatePayload(payload = {}) {
  const normalized = { ...payload };
  if (normalized.error instanceof Error) {
    normalized.error = normalized.error.message;
  }
  if (normalized.reason instanceof Error) {
    normalized.reason = normalized.reason.message;
  }
  return normalized;
}

module.exports = BootResolver;
Object.freeze(module.exports);
