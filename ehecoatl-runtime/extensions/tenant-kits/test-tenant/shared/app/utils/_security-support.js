'use strict';

const crypto = require(`node:crypto`);

const SESSION_COOKIE_NAME = `session`;
const SESSION_CACHE_TTL_SECONDS = 60 * 60 * 12;
const CSRF_HEADER_NAME = `x-csrf-token`;
const SAFE_METHODS = new Set([`GET`, `HEAD`, `OPTIONS`]);

function buildSessionCacheKey(middlewareContext, sessionId) {
  const tenantId = middlewareContext?.tenantRoute?.origin?.tenantId ?? `unknown_tenant`;
  const appId = middlewareContext?.tenantRoute?.origin?.appId ?? `unknown_app`;
  return `tenant-session:${tenantId}:${appId}:${sessionId}`;
}

function generateOpaqueToken() {
  return crypto.randomBytes(24).toString(`hex`);
}

function isSafeMethod(method) {
  return SAFE_METHODS.has(String(method ?? `GET`).trim().toUpperCase());
}

function isHttpsRequest(middlewareContext) {
  return String(middlewareContext?.requestData?.protocol ?? ``).trim().toLowerCase() === `https`;
}

function ensureSessionHelpers(middlewareContext) {
  const sessionData = middlewareContext.sessionData ?? {};
  const state = getOrCreateSessionState(sessionData);

  defineHelper(sessionData, `markDirty`, () => {
    state.dirty = true;
  });
  defineHelper(sessionData, `get`, (key, defaultValue = null) => {
    const normalizedKey = typeof key === `string` ? key.trim() : ``;
    if (!normalizedKey) return defaultValue;
    return Object.prototype.hasOwnProperty.call(sessionData, normalizedKey)
      ? sessionData[normalizedKey]
      : defaultValue;
  });
  defineHelper(sessionData, `set`, (key, value) => {
    const normalizedKey = typeof key === `string` ? key.trim() : ``;
    if (!normalizedKey) return value;
    sessionData[normalizedKey] = value;
    state.dirty = true;
    return value;
  });
  defineHelper(sessionData, `regenerateCsrfToken`, () => {
    sessionData.csrfToken = generateOpaqueToken();
    state.dirty = true;
    return sessionData.csrfToken;
  });
  defineHelper(sessionData, `destroySession`, () => {
    state.destroyed = true;
    state.dirty = true;
    for (const key of Object.keys(sessionData)) {
      if (key === `csrfToken`) continue;
      delete sessionData[key];
    }
  });

  defineHelper(sessionData, `setAuth`, (authPayload) => {
    sessionData.auth = authPayload;
    sessionData.user_id = authPayload?.user_id ?? null;
    sessionData.scopes = Array.isArray(authPayload?.scopes)
      ? [...authPayload.scopes]
      : [];
    state.dirty = true;
  });

  return state;
}

function getOrCreateSessionState(sessionData) {
  if (Object.prototype.hasOwnProperty.call(sessionData, `__sessionState`)) {
    return sessionData.__sessionState;
  }

  const state = {
    loadedSessionId: null,
    sessionId: null,
    dirty: false,
    destroyed: false,
    finishHookRegistered: false
  };

  Object.defineProperty(sessionData, `__sessionState`, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: state
  });

  return state;
}

function defineHelper(target, key, value) {
  if (Object.prototype.hasOwnProperty.call(target, key)) return;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    writable: false,
    value
  });
}

function sanitizeSessionData(sessionData) {
  const sanitized = {};
  for (const [key, value] of Object.entries(sessionData ?? {})) {
    if (typeof value === `function`) continue;
    if (key.startsWith(`__`)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function setSessionCookie(middlewareContext, sessionId) {
  middlewareContext.setCookie(SESSION_COOKIE_NAME, {
    value: sessionId,
    httpOnly: true,
    sameSite: `Lax`,
    secure: isHttpsRequest(middlewareContext),
    path: `/`,
    maxAge: SESSION_CACHE_TTL_SECONDS
  });
}

function expireSessionCookie(middlewareContext) {
  middlewareContext.setCookie(SESSION_COOKIE_NAME, {
    value: ``,
    httpOnly: true,
    sameSite: `Lax`,
    secure: isHttpsRequest(middlewareContext),
    path: `/`,
    expires: new Date(0),
    maxAge: 0
  });
}

function getSessionCookie(middlewareContext) {
  return middlewareContext?.requestData?.cookie?.[SESSION_COOKIE_NAME] ?? null;
}

function getCsrfCandidate(middlewareContext) {
  const headerValue = middlewareContext?.requestData?.headers?.[CSRF_HEADER_NAME];
  if (typeof headerValue === `string` && headerValue.trim()) {
    return headerValue.trim();
  }

  const body = middlewareContext?.requestData?.body;
  if (body && typeof body === `object`) {
    const bodyToken = body.csrfToken ?? body._csrf ?? null;
    if (typeof bodyToken === `string` && bodyToken.trim()) {
      return bodyToken.trim();
    }
  }

  return null;
}

function normalizeAuthScopes(authPayload) {
  return Array.isArray(authPayload?.scopes)
    ? authPayload.scopes
        .map((scope) => String(scope ?? ``).trim())
        .filter(Boolean)
    : [];
}

module.exports = Object.freeze({
  SESSION_COOKIE_NAME,
  SESSION_CACHE_TTL_SECONDS,
  buildSessionCacheKey,
  generateOpaqueToken,
  isSafeMethod,
  ensureSessionHelpers,
  sanitizeSessionData,
  setSessionCookie,
  expireSessionCookie,
  getSessionCookie,
  getCsrfCandidate,
  normalizeAuthScopes
});
