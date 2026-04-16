// _core/managers/web-socket-manager/web-socket-manager.js


'use strict';


const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Isolated-runtime manager for web socket client ids, metadata, and message helpers. */
class WebSocketManager extends AdaptableUseCase {
  config;
  adapter = null;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.webSocketManager);
    this.config = kernelContext.config.adapters.webSocketManager;
    super.loadAdapter();

    Object.freeze(this);
  }

  registerClient({ clientId, metadata = {} }) {
    super.loadAdapter();
    return this.adapter.registerClientAdapter({ clientId, metadata });
  }

  unregisterClient({ clientId }) {
    super.loadAdapter();
    return this.adapter.unregisterClientAdapter({ clientId });
  }

  updateClientMetadata({ clientId, metadata = {}, merge = true }) {
    super.loadAdapter();
    return this.adapter.updateClientMetadataAdapter({ clientId, metadata, merge });
  }

  getClient({ clientId }) {
    super.loadAdapter();
    return this.adapter.getClientAdapter({ clientId });
  }

  listClients() {
    super.loadAdapter();
    return this.adapter.listClientsAdapter();
  }

  sendMessage({ clientId, message = null, metadata = {} }) {
    super.loadAdapter();
    return this.adapter.sendMessageAdapter({ clientId, message, metadata });
  }

  broadcastMessage({ message = null, metadata = {}, clientIds = null }) {
    super.loadAdapter();
    return this.adapter.broadcastMessageAdapter({ message, metadata, clientIds });
  }

  receiveMessage({ clientId, message = null, metadata = {} }) {
    super.loadAdapter();
    return this.adapter.receiveMessageAdapter({ clientId, message, metadata });
  }

  onMessage(listener) {
    super.loadAdapter();
    return this.adapter.addMessageListenerAdapter(listener);
  }

  offMessage(listener) {
    super.loadAdapter();
    return this.adapter.removeMessageListenerAdapter(listener);
  }

  createClientHelper(clientId) {
    return Object.freeze({
      send: (message, metadata = {}) => this.sendMessage({ clientId, message, metadata }),
      receive: (message, metadata = {}) => this.receiveMessage({ clientId, message, metadata }),
      updateMetadata: (metadata = {}, merge = true) => this.updateClientMetadata({ clientId, metadata, merge }),
      disconnect: () => this.unregisterClient({ clientId }),
      get: () => this.getClient({ clientId })
    });
  }
}

module.exports = WebSocketManager;
Object.freeze(module.exports);
