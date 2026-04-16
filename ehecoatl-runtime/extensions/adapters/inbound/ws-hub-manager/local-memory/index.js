// adapters/outbound/ws-hub-manager/local-memory/index.js


'use strict';


const WsHubManagerPort = require(`@/_core/_ports/inbound/ws-hub-manager-port`);
const WsRoomChannel = require(`./ws-room-channel`);

WsHubManagerPort.openClientAdapter = async function openClientAdapter({
  manager,
  channelId,
  clientId,
  ws,
  metadata = {}
}) {
  const { entry } = ensureChannelEntry(manager, channelId);
  clearIdleTimer(entry);
  entry.lastActiveAt = Date.now();
  const client = entry.runtime.registerClient({
    clientId,
    ws,
    metadata
  });
  return {
    success: true,
    channelId: entry.channelId,
    clientId: client.clientId,
    client,
    activeClients: entry.runtime.clientCount()
  };
};

WsHubManagerPort.receiveMessageAdapter = async function receiveMessageAdapter({
  manager,
  channelId,
  clientId,
  message = null,
  isBinary = false,
  metadata = {}
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) {
    return createChannelNotFoundResponse(channelId);
  }

  entry.lastActiveAt = Date.now();
  return entry.runtime.receiveMessage({
    clientId,
    message,
    isBinary,
    metadata
  });
};

WsHubManagerPort.closeClientAdapter = async function closeClientAdapter({
  manager,
  channelId,
  clientId,
  code = null,
  reason = null,
  metadata = {}
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) {
    return createChannelNotFoundResponse(channelId);
  }

  entry.lastActiveAt = Date.now();
  const disconnected = entry.runtime.unregisterClient({
    clientId,
    code,
    reason,
    metadata
  });
  if (entry.runtime.clientCount() === 0) {
    scheduleIdleDestroy(manager, entry);
  }

  return {
    success: Boolean(disconnected),
    channelId: entry.channelId,
    clientId: normalizeClientId(clientId),
    activeClients: entry.runtime.clientCount()
  };
};

WsHubManagerPort.sendMessageAdapter = async function sendMessageAdapter({
  manager,
  channelId,
  clientId,
  message = null,
  metadata = {},
  isBinary = null
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) {
    return createChannelNotFoundResponse(channelId);
  }

  entry.lastActiveAt = Date.now();
  return entry.runtime.sendMessage({
    clientId,
    message,
    metadata,
    isBinary
  });
};

WsHubManagerPort.broadcastMessageAdapter = async function broadcastMessageAdapter({
  manager,
  channelId,
  clientIds = null,
  message = null,
  metadata = {},
  isBinary = null
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) {
    return createChannelNotFoundResponse(channelId);
  }

  entry.lastActiveAt = Date.now();
  return entry.runtime.broadcastMessage({
    clientIds,
    message,
    metadata,
    isBinary
  });
};

WsHubManagerPort.listChannelsAdapter = async function listChannelsAdapter({
  manager,
  appId = null,
  channelPrefix = null
}) {
  const normalizedAppId = normalizeAppId(appId);
  const normalizedChannelPrefix = normalizeChannelPrefix(channelPrefix);

  return [...(manager?.channelEntries?.keys?.() ?? [])]
    .filter((channelId) => matchesAppScope(channelId, normalizedAppId))
    .filter((channelId) => matchesChannelPrefix(channelId, normalizedChannelPrefix))
    .sort();
};

WsHubManagerPort.listClientsAdapter = async function listClientsAdapter({
  manager,
  channelId
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) return [];
  return entry.runtime.listClients();
};

WsHubManagerPort.getClientAdapter = async function getClientAdapter({
  manager,
  channelId,
  clientId
}) {
  const entry = getChannelEntry(manager, channelId);
  if (!entry) return null;
  return entry.runtime.getClient({ clientId });
};

WsHubManagerPort.destroyAdapter = async function destroyAdapter({
  manager
} = {}) {
  if (!manager?.channelEntries) return;

  for (const entry of manager.channelEntries.values()) {
    clearIdleTimer(entry);
    entry.runtime.destroy();
  }
  manager.channelEntries.clear();
};

module.exports = WsHubManagerPort;
Object.freeze(module.exports);

function ensureChannelEntry(manager, channelId) {
  const normalizedChannelId = normalizeChannelId(channelId);
  if (!normalizedChannelId) {
    throw new Error(`wsHubManager requires a non-empty channelId`);
  }

  const existing = manager.channelEntries.get(normalizedChannelId) ?? null;
  if (existing) {
    return {
      entry: existing,
      created: false
    };
  }

  const entry = {
    channelId: normalizedChannelId,
    runtime: new WsRoomChannel({
      channelId: normalizedChannelId
    }),
    idleTimer: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };
  manager.channelEntries.set(normalizedChannelId, entry);
  return {
    entry,
    created: true
  };
}

function getChannelEntry(manager, channelId) {
  const normalizedChannelId = normalizeChannelId(channelId);
  if (!normalizedChannelId) return null;
  return manager?.channelEntries?.get(normalizedChannelId) ?? null;
}

function scheduleIdleDestroy(manager, entry) {
  clearIdleTimer(entry);
  const idleMs = normalizeIdleMs(manager?.config?.idleChannelCloseMs, 30_000);
  if (idleMs <= 0) {
    entry.runtime.destroy();
    manager.channelEntries.delete(entry.channelId);
    return;
  }

  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null;
    if (entry.runtime.clientCount() > 0) return;
    entry.runtime.destroy();
    manager.channelEntries.delete(entry.channelId);
  }, idleMs);
  entry.idleTimer.unref?.();
}

function clearIdleTimer(entry) {
  if (!entry?.idleTimer) return;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function normalizeIdleMs(value, defaultValue) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return defaultValue;
  }
  return normalized;
}

function normalizeChannelId(channelId) {
  if (typeof channelId !== `string`) return null;
  const normalized = channelId.trim();
  return normalized || null;
}

function normalizeClientId(clientId) {
  if (typeof clientId !== `string`) return null;
  const normalized = clientId.trim();
  return normalized || null;
}

function normalizeAppId(appId) {
  if (typeof appId !== `string`) return null;
  const normalized = appId.trim().toLowerCase();
  return normalized || null;
}

function normalizeChannelPrefix(channelPrefix) {
  if (typeof channelPrefix !== `string`) return null;
  const normalized = channelPrefix.trim();
  return normalized || null;
}

function matchesAppScope(channelId, appId) {
  if (!appId) return true;
  return String(channelId).startsWith(`${appId}:`);
}

function matchesChannelPrefix(channelId, channelPrefix) {
  if (!channelPrefix) return true;
  return String(channelId).startsWith(channelPrefix);
}

function createChannelNotFoundResponse(channelId) {
  return {
    success: false,
    reason: `channel_not_found`,
    channelId: normalizeChannelId(channelId)
  };
}
