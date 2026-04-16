// _core/gateways/main/process-supervisor/managed-process.js


'use strict';


const { EventEmitter } = require(`events`);

/** Process handle wrapper that stores spawn metadata, environment, and state transitions. */
class ManagedProcess extends EventEmitter {
  processState;

  constructor(spawnAdapter, processOptions) {

    super();

    const {
      label,
      path,
      cwd,
      processUser,
      variables,
      serialization,
      env,
      resources,
      cleanupTasks,
    } = processOptions;

    if (typeof spawnAdapter !== "function") {
      throw new Error("ManagedProcess requires a spawnAdapter");
    }

    this.processState = `loading`;

    this.label = label;
    this.path = path;
    this.cwd = cwd;
    this.processUser = processUser ?? null;
    this.resources = resources ?? {};
    this.cleanupTasks = Array.isArray(cleanupTasks) ? cleanupTasks : [];
    this.restartOnExit = false;
    this.exitReason = null;
    this.exitTeardownPromise = new Promise((resolve) => {
      this.resolveExitTeardown = resolve;
    });
    this.env = {
      ...env,
      ...(this.processUser == null ? {} : { PROCESS_USER: this.processUser }),
    };
    this.variables = variables ?? [];
    this.serialization = serialization ?? "advanced";

    this.process = spawnAdapter({
      label,
      path,
      cwd,
      variables: this.variables,
      serialization: this.serialization,
      env: this.env
    });
  }

  get state() { return this.processState; }
  set state(value) {
    this.emit(`stateChange`, { from: this.processState, to: value });
    this.processState = value;
  }

  get pid() {
    return this.process?.pid;
  }

}

module.exports = ManagedProcess;
Object.freeze(module.exports);
