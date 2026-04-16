// adapters/outbound/ws-hub-manager/local-memory/ws-room-channel.js


'use strict';


class WsRoomChannel {
  channelId;
  clientsById;
  wsByClientId;
  createdAt;
  lastActivityAt;

  constructor({
    channelId
  }) {
    this.channelId = channelId;
    this.clientsById = new Map();
    this.wsByClientId = new Map();
    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
  }

  registerClient({
    clientId,
    ws,
    metadata = {}
  }) {
    const normalizedClientId = normalizeClientId(clientId);
    if (!normalizedClientId) {
      throw new Error(`WsRoomChannel.registerClient requires a non-empty clientId`);
    }

    const current = this.clientsById.get(normalizedClientId) ?? null;
    const client = {
      clientId: normalizedClientId,
      channelId: this.channelId,
      metadata: normalizeMetadata(metadata),
      connectedAt: current?.connectedAt ?? Date.now(),
      disconnectedAt: null,
      lastInboundAt: current?.lastInboundAt ?? null,
      lastOutboundAt: current?.lastOutboundAt ?? null
    };
    this.clientsById.set(normalizedClientId, client);
    this.wsByClientId.set(normalizedClientId, ws ?? null);
    this.lastActivityAt = Date.now();
    return cloneClient(client);
  }

  unregisterClient({
    clientId,
    code = null,
    reason = null,
    metadata = {}
  }) {
    const normalizedClientId = normalizeClientId(clientId);
    const client = this.clientsById.get(normalizedClientId) ?? null;
    this.wsByClientId.delete(normalizedClientId);
    if (!client) return false;

    this.clientsById.delete(normalizedClientId);
    this.lastActivityAt = Date.now();
    return Object.freeze({
      ...cloneClient(client),
      disconnectedAt: Date.now(),
      close: Object.freeze({
        code: code ?? null,
        reason: normalizeCloseReason(reason),
        metadata: normalizeMetadata(metadata)
      })
    });
  }

  getClient({
    clientId
  }) {
    const normalizedClientId = normalizeClientId(clientId);
    const client = this.clientsById.get(normalizedClientId) ?? null;
    return client ? cloneClient(client) : null;
  }

  listClients() {
    return [...this.clientsById.values()].map(cloneClient);
  }

  updateClientMetadata({
    clientId,
    metadata = {}
  }) {
    const normalizedClientId = normalizeClientId(clientId);
    const client = this.clientsById.get(normalizedClientId) ?? null;
    if (!client) {
      return null;
    }

    client.metadata = normalizeMetadata({
      ...client.metadata,
      ...metadata
    });
    this.lastActivityAt = Date.now();
    return cloneClient(client);
  }

  clientCount() {
    return this.clientsById.size;
  }

  receiveMessage({
    clientId,
    message = null,
    isBinary = false,
    metadata = {}
  }) {
    const client = this.clientsById.get(normalizeClientId(clientId)) ?? null;
    if (!client) {
      return createClientNotFoundResponse(clientId, this.channelId);
    }

    client.lastInboundAt = Date.now();
    this.lastActivityAt = client.lastInboundAt;
    return {
      success: true,
      channelId: this.channelId,
      clientId: client.clientId,
      event: Object.freeze({
        direction: `inbound`,
        channelId: this.channelId,
        clientId: client.clientId,
        isBinary: Boolean(isBinary),
        message: normalizeInboundMessage(message, isBinary),
        metadata: normalizeMetadata(metadata),
        client: cloneClient(client),
        at: client.lastInboundAt
      })
    };
  }

  sendMessage({
    clientId,
    message = null,
    metadata = {},
    isBinary = null
  }) {
    const client = this.clientsById.get(normalizeClientId(clientId)) ?? null;
    if (!client) {
      return createClientNotFoundResponse(clientId, this.channelId);
    }

    const ws = this.wsByClientId.get(client.clientId) ?? null;
    if (!ws || typeof ws.send !== `function`) {
      return {
        success: false,
        reason: `ws_not_available`,
        channelId: this.channelId,
        clientId: client.clientId
      };
    }

    const outbound = normalizeOutboundPayload(message, isBinary);
    ws.send(outbound.message, outbound.isBinary);
    client.lastOutboundAt = Date.now();
    this.lastActivityAt = client.lastOutboundAt;
    return {
      success: true,
      delivered: 1,
      channelId: this.channelId,
      clientId: client.clientId,
      event: Object.freeze({
        direction: `outbound`,
        channelId: this.channelId,
        clientId: client.clientId,
        isBinary: outbound.isBinary,
        message: outbound.message,
        metadata: normalizeMetadata(metadata),
        client: cloneClient(client),
        at: client.lastOutboundAt
      })
    };
  }

  broadcastMessage({
    clientIds = null,
    message = null,
    metadata = {},
    isBinary = null
  }) {
    const targets = Array.isArray(clientIds) && clientIds.length > 0
      ? clientIds.map(normalizeClientId).filter(Boolean)
      : [...this.clientsById.keys()];

    const results = targets.map((clientId) => this.sendMessage({
      clientId,
      message,
      metadata,
      isBinary
    }));
    return {
      success: true,
      channelId: this.channelId,
      attempted: targets.length,
      delivered: results.filter((result) => result?.success === true).length,
      results
    };
  }

  destroy() {
    this.clientsById.clear();
    this.wsByClientId.clear();
  }
}

module.exports = WsRoomChannel;
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
    channelId: client.channelId,
    metadata: normalizeMetadata(client.metadata),
    connectedAt: client.connectedAt ?? null,
    disconnectedAt: client.disconnectedAt ?? null,
    lastInboundAt: client.lastInboundAt ?? null,
    lastOutboundAt: client.lastOutboundAt ?? null
  });
}

function normalizeInboundMessage(message, isBinary) {
  if (message == null) return null;
  if (Buffer.isBuffer(message)) {
    return isBinary ? message : message.toString(`utf8`);
  }
  if (message instanceof ArrayBuffer) {
    const buffer = Buffer.from(message);
    return isBinary ? buffer : buffer.toString(`utf8`);
  }
  if (ArrayBuffer.isView(message)) {
    const buffer = Buffer.from(message.buffer, message.byteOffset, message.byteLength);
    return isBinary ? buffer : buffer.toString(`utf8`);
  }
  return message;
}

function normalizeOutboundPayload(message, isBinary = null) {
  if (Buffer.isBuffer(message)) {
    return {
      message,
      isBinary: isBinary ?? true
    };
  }
  if (message instanceof ArrayBuffer) {
    return {
      message: Buffer.from(message),
      isBinary: isBinary ?? true
    };
  }
  if (ArrayBuffer.isView(message)) {
    return {
      message: Buffer.from(message.buffer, message.byteOffset, message.byteLength),
      isBinary: isBinary ?? true
    };
  }
  if (typeof message === `string`) {
    return {
      message,
      isBinary: isBinary ?? false
    };
  }
  return {
    message: JSON.stringify(message ?? null),
    isBinary: isBinary ?? false
  };
}

function normalizeCloseReason(reason) {
  if (reason == null) return null;
  if (Buffer.isBuffer(reason)) return reason.toString(`utf8`);
  if (reason instanceof ArrayBuffer) return Buffer.from(reason).toString(`utf8`);
  if (ArrayBuffer.isView(reason)) {
    return Buffer.from(reason.buffer, reason.byteOffset, reason.byteLength).toString(`utf8`);
  }
  return String(reason);
}

function createClientNotFoundResponse(clientId, channelId) {
  return {
    success: false,
    reason: `client_not_found`,
    channelId,
    clientId: normalizeClientId(clientId)
  };
}
