// adapters/outbound/web-socket-manager/local-memory.js


'use strict';


const WebSocketManagerPort = require(`@/_core/_ports/outbound/web-socket-manager-port`);

const clients = new Map();
const messageListeners = new Set();

WebSocketManagerPort.registerClientAdapter = function registerClientAdapter({
  clientId,
  metadata = {}
}) {
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId) {
    throw new Error(`webSocketManager.registerClient requires a non-empty clientId`);
  }

  const existing = clients.get(normalizedClientId) ?? {};
  const client = {
    clientId: normalizedClientId,
    metadata: normalizeMetadata(existing.metadata ?? metadata),
    connectedAt: existing.connectedAt ?? Date.now(),
    lastInboundAt: existing.lastInboundAt ?? null,
    lastOutboundAt: existing.lastOutboundAt ?? null
  };
  clients.set(normalizedClientId, client);
  return cloneClient(client);
};

WebSocketManagerPort.unregisterClientAdapter = function unregisterClientAdapter({ clientId }) {
  return clients.delete(normalizeClientId(clientId));
};

WebSocketManagerPort.updateClientMetadataAdapter = function updateClientMetadataAdapter({
  clientId,
  metadata = {},
  merge = true
}) {
  const normalizedClientId = normalizeClientId(clientId);
  const current = clients.get(normalizedClientId);
  if (!current) return null;

  current.metadata = merge
    ? { ...normalizeMetadata(current.metadata), ...normalizeMetadata(metadata) }
    : normalizeMetadata(metadata);

  return cloneClient(current);
};

WebSocketManagerPort.getClientAdapter = function getClientAdapter({ clientId }) {
  const client = clients.get(normalizeClientId(clientId));
  return client ? cloneClient(client) : null;
};

WebSocketManagerPort.listClientsAdapter = function listClientsAdapter() {
  return [...clients.values()].map(cloneClient);
};

WebSocketManagerPort.sendMessageAdapter = function sendMessageAdapter({
  clientId,
  message = null,
  metadata = {}
}) {
  const client = clients.get(normalizeClientId(clientId));
  if (!client) {
    return {
      success: false,
      reason: `client_not_found`,
      clientId: normalizeClientId(clientId) ?? null
    };
  }

  client.lastOutboundAt = Date.now();
  const event = Object.freeze({
    direction: `outbound`,
    clientId: client.clientId,
    message,
    metadata: normalizeMetadata(metadata),
    client: cloneClient(client),
    at: client.lastOutboundAt
  });
  emitMessageEvent(event);

  return {
    success: true,
    delivered: 1,
    clientId: client.clientId,
    event
  };
};

WebSocketManagerPort.broadcastMessageAdapter = function broadcastMessageAdapter({
  message = null,
  metadata = {},
  clientIds = null
}) {
  const targets = Array.isArray(clientIds) && clientIds.length > 0
    ? clientIds.map(normalizeClientId).filter(Boolean)
    : [...clients.keys()];

  const results = [];
  for (const clientId of targets) {
    results.push(WebSocketManagerPort.sendMessageAdapter({
      clientId,
      message,
      metadata
    }));
  }

  return {
    success: true,
    delivered: results.filter((result) => result?.success === true).length,
    attempted: targets.length,
    results
  };
};

WebSocketManagerPort.receiveMessageAdapter = function receiveMessageAdapter({
  clientId,
  message = null,
  metadata = {}
}) {
  const client = clients.get(normalizeClientId(clientId));
  if (!client) {
    return {
      success: false,
      reason: `client_not_found`,
      clientId: normalizeClientId(clientId) ?? null
    };
  }

  client.lastInboundAt = Date.now();
  const event = Object.freeze({
    direction: `inbound`,
    clientId: client.clientId,
    message,
    metadata: normalizeMetadata(metadata),
    client: cloneClient(client),
    at: client.lastInboundAt
  });
  emitMessageEvent(event);

  return {
    success: true,
    clientId: client.clientId,
    event
  };
};

WebSocketManagerPort.addMessageListenerAdapter = function addMessageListenerAdapter(listener) {
  if (typeof listener !== `function`) {
    throw new Error(`webSocketManager.onMessage requires a function listener`);
  }

  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
};

WebSocketManagerPort.removeMessageListenerAdapter = function removeMessageListenerAdapter(listener) {
  return messageListeners.delete(listener);
};

WebSocketManagerPort.destroyAdapter = async function destroyAdapter() {
  clients.clear();
  messageListeners.clear();
};

module.exports = WebSocketManagerPort;
Object.freeze(module.exports);

function normalizeClientId(clientId) {
  if (typeof clientId !== `string`) return null;
  const normalized = clientId.trim();
  return normalized || null;
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === `object`
    ? { ...metadata }
    : {};
}

function cloneClient(client) {
  return Object.freeze({
    clientId: client.clientId,
    metadata: normalizeMetadata(client.metadata),
    connectedAt: client.connectedAt ?? null,
    lastInboundAt: client.lastInboundAt ?? null,
    lastOutboundAt: client.lastOutboundAt ?? null
  });
}

function emitMessageEvent(event) {
  for (const listener of messageListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(`[web-socket-manager] message listener failed`, error);
    }
  }
}
