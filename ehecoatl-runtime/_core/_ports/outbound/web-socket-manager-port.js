// _core/_ports/outbound/managers/web-socket-manager-port.js


'use strict';


/** Contract singleton for isolated-runtime websocket client registry and message handling. */
class WebSocketManagerPort {
  registerClientAdapter;
  unregisterClientAdapter;
  updateClientMetadataAdapter;
  getClientAdapter;
  listClientsAdapter;
  sendMessageAdapter;
  broadcastMessageAdapter;
  receiveMessageAdapter;
  addMessageListenerAdapter;
  removeMessageListenerAdapter;
  destroyAdapter = async () => { };
}

module.exports = new WebSocketManagerPort();
Object.preventExtensions(module.exports);
