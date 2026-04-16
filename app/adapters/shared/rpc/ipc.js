// adapters/shared/rpc/ipc.js


'use strict';


const RpcAdapter = require(`g@/shared/rpc/rpc-adapter`);

const getPIDAdapter = function () { return process.pid; };
RpcAdapter.getPIDAdapter = getPIDAdapter;

/* -----------------------------
   TRANSPORT SEND ADAPTER
------------------------------ */

const sendMessageAdapter = function (targetProcess, payload) {
  try {
    if (targetProcess && typeof targetProcess.send === "function") // direct send
      return targetProcess.send(payload);// direct send

    if (typeof process.send === "function") //send message upwards
      return process.send(payload); //send message upwards
  } catch (error) {
    if ([`EPIPE`, `ERR_IPC_CHANNEL_CLOSED`].includes(error?.code)) {
      return false;
    }
    throw error;
  }

  return undefined;// signal that the message was not delivered so the channel can loopback
};
RpcAdapter.sendMessageAdapter = sendMessageAdapter;

/* -----------------------------
   REGISTER CALLBACK FOR MESSAGE RECEIVING
------------------------------ */

/**
 * @param {(payload:any)=>void} handler
 */
const rpcStartListeningAdapter = function (handler) {
  process.on(`message`, (message) => {
    if (!message || typeof message !== `object`) return;
    return handler(message);
  });
};
RpcAdapter.rpcStartListeningAdapter = rpcStartListeningAdapter;

module.exports = RpcAdapter;
Object.freeze(RpcAdapter);
