// _core/_ports/inbound/runtimes/ingress-runtime-port.js


'use strict';


/** Contract singleton for HTTP listener setup and execution-context factory integration. */
class IngressRuntimePort {
  /**
   * @type {(params: {
   * services: any,
   * httpCoreIngressPort,
   * wsCoreIngressPort,
   * ingressRuntimeConfig: typeof import('@/config/default.config').adapters.ingressRuntime,
   * createExecutionContext: (params: any) => import('@/_core/runtimes/ingress-runtime/execution/execution-context')
   * }) => Promise<any>}
   */
  setupAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new IngressRuntimePort();
Object.preventExtensions(module.exports);
