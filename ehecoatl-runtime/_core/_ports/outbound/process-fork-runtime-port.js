// _core/_ports/outbound/runtimes/process-fork-runtime-port.js


'use strict';


/** Contract singleton for process creation, initialization, and current-process port methods. */
class ProcessForkRuntimePort {
  /**
   * @type {(params: {
   * path: string,
   * cwd?: string,
   * variables?: string[],
   * serialization?: string,
   * env?: NodeJS.ProcessEnv,
   * resources?: {
   *   nodeMaxOldSpaceSizeMb?: number
   * }
   * }) => import('child_process').ChildProcess}
   */
  spawnAdapter;
  /**
   * @type {(params: {
   * managedProcess: import('@/_core/runtimes/process-fork-runtime/managed-process'),
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

module.exports = new ProcessForkRuntimePort();
Object.preventExtensions(module.exports);
