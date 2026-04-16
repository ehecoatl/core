// _core/gateways/main/process-supervisor/process-supervisor-adapter.js


'use strict';


/** Contract singleton for process creation, initialization, and current-process adapter methods. */
class ProcessSupervisorAdapter {
  /**
   * @type {(params: {
   * path: string,
   * cwd?: string,
   * variables?: string[],
   * serialization?: string,
   * env?: NodeJS.ProcessEnv
   * }) => import('child_process').ChildProcess}
   */
  spawnAdapter;
  /**
   * @type {(params: {
   * managedProcess: import('./managed-process'),
   * onExitCallback: (...args: any[]) => any,
   * onMessageToRootCallback: (...args: any[]) => any
   * }) => void}
   */
  initAdapter;
  /** @type {() => NodeJS.Process} */
  currentProcessAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new ProcessSupervisorAdapter();
Object.preventExtensions(module.exports);
