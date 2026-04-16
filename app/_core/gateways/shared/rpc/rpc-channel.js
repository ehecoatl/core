// _core/gateways/shared/rpc/rpc-channel.js


'use strict';


/** Low-level RPC transport wrapper over the active adapter send/listen primitives. */
class RpcChannel {
  rpcStartListeningAdapter;
  sendMessageAdapter;
  getPIDAdapter;

  /** Validates and stores the low-level transport primitives used by shared RPC. */
  constructor({ sendMessageAdapter, rpcStartListeningAdapter, getPIDAdapter }) {
    if (typeof sendMessageAdapter !== "function")
      throw new Error("RpcChannel requires a sendMessageAdapter");
    if (typeof rpcStartListeningAdapter !== "function")
      throw new Error("RpcChannel requires a rpcStartListening");

    this.getPIDAdapter = getPIDAdapter;
    this.sendMessageAdapter = sendMessageAdapter;
    this.rpcStartListeningAdapter = rpcStartListeningAdapter;
  }

  /** Sends one payload through the transport adapter to a target process handle. */
  sendMessage(targetProcess, payload) { // targetProcess null means send upwards
    return this.sendMessageAdapter(targetProcess ?? null, payload);
  }

  /** Starts inbound transport listening with the provided receive callback. */
  rpcStartListening(onReceiveCallback) {
    this.rpcStartListeningAdapter(onReceiveCallback);
  }

  /** Returns the current process pid through the transport adapter. */
  getPID() {
    return this.getPIDAdapter();
  }

}

module.exports = RpcChannel;
Object.freeze(module.exports);
