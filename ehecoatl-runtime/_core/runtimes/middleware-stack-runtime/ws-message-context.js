'use strict';

const TenantRoute = require(`@/_core/runtimes/ingress-runtime/execution/tenant-route`);

class WsMessageContext {
  tenantRoute;
  sessionData;
  wsMessageData;
  middlewareStackRuntimeConfig;
  services;
  meta;

  #discarded;
  #discardReason;
  #sendToSender;
  #replySent;

  constructor({
    tenantRoute,
    sessionData = {},
    wsMessageData,
    middlewareStackRuntimeConfig = null,
    services = {},
    sendToSender = null
  }) {
    this.tenantRoute = tenantRoute instanceof TenantRoute
      ? tenantRoute
      : new TenantRoute(tenantRoute ?? {});
    this.sessionData = sessionData && typeof sessionData === `object`
      ? sessionData
      : {};
    this.wsMessageData = wsMessageData && typeof wsMessageData === `object`
      ? wsMessageData
      : {};
    this.middlewareStackRuntimeConfig = middlewareStackRuntimeConfig ?? null;
    this.services = services ?? {};
    this.meta = {
      currentMiddlewareIndex: null,
      currentMiddlewareName: null
    };

    this.#discarded = false;
    this.#discardReason = null;
    this.#sendToSender = typeof sendToSender === `function`
      ? sendToSender
      : null;
    this.#replySent = false;

    Object.preventExtensions(this);
  }

  discard(reason = `discarded`) {
    this.#discarded = true;
    this.#discardReason = typeof reason === `string` && reason.trim()
      ? reason.trim()
      : `discarded`;
  }

  isDiscarded() {
    return this.#discarded;
  }

  getDiscardReason() {
    return this.#discardReason;
  }

  async sendToSender(message, {
    metadata = {},
    isBinary = null
  } = {}) {
    if (!this.#sendToSender) {
      return {
        success: false,
        reason: `sender_delivery_not_available`
      };
    }

    const result = await this.#sendToSender(message, {
      metadata,
      isBinary
    });
    if (result?.success === true) {
      this.#replySent = true;
    }
    return result;
  }

  hasReplySent() {
    return this.#replySent;
  }
}

module.exports = WsMessageContext;
Object.freeze(module.exports);
