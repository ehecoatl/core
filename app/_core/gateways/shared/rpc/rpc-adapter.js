// _core/gateways/shared/rpc/rpc-adapter.js


'use strict';


/** Contract singleton for process-local RPC transport adapter methods. */
class RpcAdapter {
  /** @type {(targetProcess: any, payload: any) => any} */
  sendMessageAdapter;
  /** @type {(handler: (payload: any) => void) => void} */
  rpcStartListeningAdapter;
  /** @type {() => number} */
  getPIDAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new RpcAdapter();
Object.preventExtensions(module.exports);
