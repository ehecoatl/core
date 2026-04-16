// _core/_ports/outbound/runtimes/rpc-runtime-port.js


'use strict';


/** Contract singleton for process-local RPC transport adapter methods. */
class RpcRuntimePort {
  /** @type {(targetProcess: any, payload: any) => any} */
  sendMessageAdapter;
  /** @type {(handler: (payload: any) => void) => void} */
  rpcStartListeningAdapter;
  /** @type {() => number} */
  getPIDAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new RpcRuntimePort();
Object.preventExtensions(module.exports);
