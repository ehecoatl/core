// _core/managers/ws-hub-manager/ws-hub-manager.js


'use strict';


const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Transport-local websocket hub that owns live channel runtimes and app-facing WS commands. */
class WsHubManager extends AdaptableUseCase {
  config;
  channelEntries;
  useCases;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.wsHubManager);
    this.config = kernelContext.config.adapters.wsHubManager ?? {};
    this.channelEntries = new Map();
    this.useCases = kernelContext.useCases ?? {};

    Object.freeze(this);
  }

  async openClient({
    channelId,
    clientId,
    ws,
    metadata = {}
  }) {
    return this.#callAdapter(`openClientAdapter`, {
      channelId,
      clientId,
      ws,
      metadata
    });
  }

  async receiveMessage({
    channelId,
    clientId,
    message = null,
    isBinary = false,
    metadata = {}
  }) {
    return this.#callAdapter(`receiveMessageAdapter`, {
      channelId,
      clientId,
      message,
      isBinary,
      metadata
    });
  }

  async closeClient({
    channelId,
    clientId,
    code = null,
    reason = null,
    metadata = {}
  }) {
    return this.#callAdapter(`closeClientAdapter`, {
      channelId,
      clientId,
      code,
      reason,
      metadata
    });
  }

  async sendMessage({
    channelId,
    clientId,
    message = null,
    metadata = {},
    isBinary = null
  }) {
    return this.#callAdapter(`sendMessageAdapter`, {
      channelId,
      clientId,
      message,
      metadata,
      isBinary
    });
  }

  async broadcastMessage({
    channelId,
    clientIds = null,
    message = null,
    metadata = {},
    isBinary = null
  }) {
    return this.#callAdapter(`broadcastMessageAdapter`, {
      channelId,
      clientIds,
      message,
      metadata,
      isBinary
    });
  }

  async listClients({
    channelId
  }) {
    return this.#callAdapter(`listClientsAdapter`, {
      channelId
    });
  }

  async listChannels({
    appId = null,
    channelPrefix = null
  } = {}) {
    return this.#callAdapter(`listChannelsAdapter`, {
      appId,
      channelPrefix
    });
  }

  async getClient({
    channelId,
    clientId
  }) {
    return this.#callAdapter(`getClientAdapter`, {
      channelId,
      clientId
    });
  }

  async handleCommand({
    command,
    ...payload
  } = {}) {
    const normalizedCommand = normalizeCommand(command);
    if (!normalizedCommand) {
      return {
        success: false,
        reason: `missing_command`
      };
    }

    if (normalizedCommand === `sendMessage`) {
      return this.sendMessage(payload);
    }
    if (normalizedCommand === `broadcastMessage`) {
      return this.broadcastMessage(payload);
    }
    if (normalizedCommand === `listChannels`) {
      return this.listChannels(payload);
    }
    if (normalizedCommand === `listClients`) {
      return this.listClients(payload);
    }
    if (normalizedCommand === `getClient`) {
      return this.getClient(payload);
    }

    return {
      success: false,
      reason: `unsupported_command`,
      command: normalizedCommand
    };
  }

  async destroy() {
    await this.adapter?.destroyAdapter?.({
      manager: this
    });
  }

  async #callAdapter(methodName, payload) {
    const adapterMethod = this.adapter?.[methodName] ?? null;
    if (typeof adapterMethod !== `function`) {
      throw new Error(`WsHubManager adapter method "${methodName}" is not available`);
    }

    return await adapterMethod({
      manager: this,
      ...payload
    });
  }
}

function normalizeCommand(command) {
  if (typeof command !== `string`) return null;
  const normalized = command.trim();
  return normalized || null;
}

module.exports = WsHubManager;
Object.freeze(module.exports);
