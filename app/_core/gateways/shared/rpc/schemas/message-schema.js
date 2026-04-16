// _core/gateways/shared/rpc/schemas/message-schema.js


'use strict';


/** Static message factory and validator for RPC question and answer payload shapes. */
class MessageSchema {

  /** Builds a normalized question payload with routing and correlation metadata. */
  static createQuestion({ id, question, data, target = undefined, origin = undefined, internalMeta = undefined }) {
    return {
      id,
      question,
      data,
      target,
      origin,
      internalMeta,
      answer: false
    };
  }

  /** Builds a normalized answer payload derived from an original question. */
  static createAnswer({ payload, origin, data, internalMeta = undefined }) {
    return {
      ...payload,
      data,
      internalMeta: mergeInternalMeta(payload.internalMeta, internalMeta),
      origin,
      target: payload.origin,
      answer: true
    };
  }

  /** Checks whether a payload shape represents an RPC answer. */
  static isAnswer(payload) {
    return !!payload.answer;
  }

  /** Checks whether a payload shape represents an RPC question. */
  static isQuestion(payload) {
    return !payload.answer;
  }
}

function mergeInternalMeta(baseMeta, extraMeta) {
  if (!baseMeta && !extraMeta) return undefined;
  if (!baseMeta) return extraMeta;
  if (!extraMeta) return baseMeta;

  return {
    ...baseMeta,
    ...extraMeta,
    controllerMeta: mergeObject(baseMeta.controllerMeta, extraMeta.controllerMeta)
  };
}

function mergeObject(baseValue, extraValue) {
  if (!baseValue && !extraValue) return undefined;
  if (!baseValue) return extraValue;
  if (!extraValue) return baseValue;
  return {
    ...baseValue,
    ...extraValue
  };
}

module.exports = MessageSchema;
Object.freeze(module.exports);
