// _core/gateways/engine/network-engine/network-engine-adapter.js


'use strict';


/** Contract singleton for network listener setup and execution-context factory integration. */
class NetworkEngineAdapter {
  /**
   * @type {(params: {
   * services: any,
   * networkConfig: typeof import('@/config/default.config').networkEngine,
   * createExecutionContext: (params: any) => import('g@/engine/network-engine/execution/execution-context')
   * }) => Promise<any>}
   */
  setupAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new NetworkEngineAdapter();
Object.preventExtensions(module.exports);
