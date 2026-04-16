// _core/_ports/inbound/ws-hub-manager-port.js


'use strict';


/** Contract singleton for adapter-backed websocket hub lifecycle and channel command operations. */
class WsHubManagerPort {
  openClientAdapter;
  receiveMessageAdapter;
  closeClientAdapter;
  sendMessageAdapter;
  broadcastMessageAdapter;
  listChannelsAdapter;
  listClientsAdapter;
  getClientAdapter;
  destroyAdapter = async () => { };
}

module.exports = new WsHubManagerPort();
Object.preventExtensions(module.exports);
