// _core/runtimes/ws-app-runtime/ws-app-runtime.js


'use strict';


const { getProcessLabel } = require(`@/contracts/utils`);

/** Isolated-runtime tunnel that exposes tenant-transport websocket hub commands as services.ws. */
class WsAppRuntime {
  config;
  rpcEndpoint;
  tenantId;
  appId;
  targetLabel;
  question;

  constructor({
    config,
    rpcEndpoint,
    tenantId = null,
    appId = null
  } = {}) {
    this.config = config ?? {};
    this.rpcEndpoint = rpcEndpoint ?? null;
    this.tenantId = normalizeKey(tenantId);
    this.appId = normalizeKey(appId);
    this.targetLabel = this.tenantId
      ? getProcessLabel(`tenantScope`, `transport`, {
        tenant_id: this.tenantId
      })
      : null;
    this.question = this.config?.adapters?.wsHubManager?.question?.command ?? `wsHub`;
  }

  createService() {
    return Object.freeze({
      listChannels: async ({
        appScoped = true
      } = {}) => {
        return this.#ask(`listChannels`, {
          appId: appScoped ? this.appId : null
        });
      },
      sendMessage: async ({ channelId, clientId, message = null, metadata = {}, isBinary = null } = {}) => {
        return this.#ask(`sendMessage`, {
          channelId: this.normalizeChannelId(channelId),
          clientId: normalizeClientId(clientId),
          message,
          metadata,
          isBinary
        });
      },
      broadcastMessage: async ({ channelId, clientIds = null, message = null, metadata = {}, isBinary = null } = {}) => {
        return this.#ask(`broadcastMessage`, {
          channelId: this.normalizeChannelId(channelId),
          clientIds: Array.isArray(clientIds)
            ? clientIds.map(normalizeClientId).filter(Boolean)
            : null,
          message,
          metadata,
          isBinary
        });
      },
      listClients: async ({ channelId } = {}) => {
        return this.#ask(`listClients`, {
          channelId: this.normalizeChannelId(channelId)
        });
      },
      getClient: async ({ channelId, clientId } = {}) => {
        return this.#ask(`getClient`, {
          channelId: this.normalizeChannelId(channelId),
          clientId: normalizeClientId(clientId)
        });
      }
    });
  }

  normalizeChannelId(channelId) {
    const normalizedChannelId = typeof channelId === `string`
      ? channelId.trim()
      : ``;
    if (!normalizedChannelId) {
      throw new Error(`services.ws requires a non-empty channelId`);
    }

    if (isPrefixedChannelId(normalizedChannelId)) {
      return normalizedChannelId;
    }

    if (!this.appId) {
      return normalizedChannelId.startsWith(`/`)
        ? normalizedChannelId
        : `/${normalizedChannelId}`;
    }

    const normalizedPath = normalizedChannelId.startsWith(`/`)
      ? normalizedChannelId
      : `/${normalizedChannelId}`;
    return `${this.appId}:${normalizedPath}`;
  }

  async #ask(command, payload) {
    if (!this.rpcEndpoint || typeof this.rpcEndpoint.ask !== `function`) {
      throw new Error(`services.ws RPC endpoint is not available`);
    }
    if (!this.targetLabel) {
      throw new Error(`services.ws transport target label is not available`);
    }

    return this.rpcEndpoint.ask({
      target: this.targetLabel,
      question: this.question,
      data: {
        command,
        ...payload
      }
    });
  }
}

module.exports = WsAppRuntime;
Object.freeze(module.exports);

function normalizeKey(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeClientId(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim();
  return normalized || null;
}

function isPrefixedChannelId(channelId) {
  return /^[^/:\s][^:\s]*:/.test(channelId);
}
