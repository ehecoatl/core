// adapters/shared/rpc-runtime/ipc.js


'use strict';


const RpcPort = require(`@/_core/_ports/outbound/rpc-runtime-port`);

const getPIDAdapter = function () { return process.pid; };
RpcPort.getPIDAdapter = getPIDAdapter;

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
RpcPort.sendMessageAdapter = sendMessageAdapter;

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
RpcPort.rpcStartListeningAdapter = rpcStartListeningAdapter;

module.exports = RpcPort;
Object.freeze(RpcPort);
