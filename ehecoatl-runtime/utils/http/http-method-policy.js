'use strict';

const DEFAULT_METHODS = Object.freeze([`GET`]);
const BLOCKED_METHODS = Object.freeze([`CONNECT`, `TRACE`]);
const CAPABILITY_METHOD = `OPTIONS`;
const IMPLIED_HEAD_SOURCE = `GET`;
const IMPLIED_HEAD_METHOD = `HEAD`;

function normalizeDeclaredMethods(methods, fallback = DEFAULT_METHODS) {
  const source = Array.isArray(methods) && methods.length > 0
    ? methods
    : fallback;

  const normalized = [];
  for (const method of source) {
    const normalizedMethod = normalizeMethod(method);
    if (!normalizedMethod) continue;
    if (isMethodBlocked(normalizedMethod)) continue;
    if (!normalized.includes(normalizedMethod)) {
      normalized.push(normalizedMethod);
    }
  }

  if (normalized.length === 0 && fallback !== null) {
    return normalizeDeclaredMethods(fallback, null);
  }

  return Object.freeze(normalized);
}

function buildEffectiveMethods(methods) {
  const declared = Array.isArray(methods)
    ? methods.map((entry) => normalizeMethod(entry)).filter(Boolean)
    : normalizeDeclaredMethods(methods);
  const effective = [];

  for (const method of declared) {
    if (isMethodBlocked(method)) continue;
    if (!effective.includes(method)) {
      effective.push(method);
    }
    if (method === IMPLIED_HEAD_SOURCE && !effective.includes(IMPLIED_HEAD_METHOD)) {
      effective.push(IMPLIED_HEAD_METHOD);
    }
  }

  if (!effective.includes(CAPABILITY_METHOD)) {
    effective.push(CAPABILITY_METHOD);
  }

  return Object.freeze(effective);
}

function normalizeMethod(method) {
  const normalized = String(method ?? ``).trim().toUpperCase();
  return normalized || null;
}

function isMethodBlocked(method) {
  const normalized = normalizeMethod(method);
  return Boolean(normalized && BLOCKED_METHODS.includes(normalized));
}

function renderAllowHeader(methods) {
  return buildEffectiveMethods(methods).join(`, `);
}

module.exports = {
  BLOCKED_METHODS,
  CAPABILITY_METHOD,
  IMPLIED_HEAD_METHOD,
  IMPLIED_HEAD_SOURCE,
  normalizeDeclaredMethods,
  buildEffectiveMethods,
  normalizeMethod,
  isMethodBlocked,
  renderAllowHeader
};

Object.freeze(module.exports);
