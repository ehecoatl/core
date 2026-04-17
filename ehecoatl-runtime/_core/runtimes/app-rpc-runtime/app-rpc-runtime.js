'use strict';

class AppRpcRuntime {
  rpcEndpoint;
  tenantId;
  appId;

  constructor({
    rpcEndpoint,
    tenantId = null,
    appId = null
  } = {}) {
    this.rpcEndpoint = rpcEndpoint ?? null;
    this.tenantId = normalizeKey(tenantId);
    this.appId = normalizeKey(appId);
  }

  createService() {
    return Object.freeze({
      ask: async (payload = {}) => await this.#call(`ask`, payload),
      askDetailed: async (payload = {}) => await this.#call(`askDetailed`, payload),
      askLocal: async (payload = {}) => await this.#call(`askLocal`, payload),
      addListener: (...args) => this.rpcEndpoint?.addListener?.(...args),
      removeListener: (...args) => this.rpcEndpoint?.removeListener?.(...args)
    });
  }

  async #call(method, payload = {}) {
    if (!this.rpcEndpoint || typeof this.rpcEndpoint?.[method] !== `function`) {
      throw new Error(`services.rpc endpoint is not available`);
    }

    return this.rpcEndpoint[method](normalizeRpcPayload(payload, {
      tenantId: this.tenantId,
      appId: this.appId
    }));
  }
}

function normalizeRpcPayload(payload = {}, { tenantId = null, appId = null } = {}) {
  const {
    question,
    data,
    internalMeta,
    ...rest
  } = payload ?? {};

  const normalizedQuestion = isQuestionEnvelope(question)
    ? question.type
    : question;
  const normalizedData = isQuestionEnvelope(question)
    ? question.payload
    : data;

  return {
    ...rest,
    question: normalizedQuestion,
    data: normalizedData,
    internalMeta: mergeInternalMeta(internalMeta, {
      appRpcContext: {
        tenantId,
        appId
      }
    })
  };
}

function isQuestionEnvelope(question) {
  return !!question
    && typeof question === `object`
    && !Array.isArray(question)
    && typeof question.type === `string`
    && question.type.trim() !== ``;
}

function mergeInternalMeta(baseMeta, extraMeta) {
  if (!baseMeta) return extraMeta;
  if (!extraMeta) return baseMeta;

  return {
    ...baseMeta,
    ...extraMeta,
    appRpcContext: {
      ...(baseMeta.appRpcContext ?? {}),
      ...(extraMeta.appRpcContext ?? {})
    }
  };
}

function normalizeKey(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

module.exports = AppRpcRuntime;
Object.freeze(module.exports);
