'use strict';

const {
  SESSION_CACHE_TTL_SECONDS,
  buildSessionCacheKey,
  ensureSessionHelpers,
  sanitizeSessionData
} = require(`../../utils/_security-support`);

module.exports = async function wsMessageSessionMiddleware(middlewareContext, next) {
  const sessionData = middlewareContext.sessionData ?? {};
  const state = ensureSessionHelpers(middlewareContext);
  const cache = middlewareContext.services?.cache ?? null;
  const syncSessionSnapshot = middlewareContext.services?.syncSessionSnapshot ?? null;

  if (state.sessionId == null) {
    const resolvedSessionId = resolveWsSessionId(middlewareContext);
    if (resolvedSessionId) {
      state.loadedSessionId = resolvedSessionId;
      state.sessionId = resolvedSessionId;
      const cachedPayload = await cache?.get?.(buildSessionCacheKey(middlewareContext, resolvedSessionId), null) ?? null;
      if (cachedPayload) {
        try {
          const parsedPayload = JSON.parse(cachedPayload);
          if (parsedPayload && typeof parsedPayload === `object`) {
            Object.assign(sessionData, parsedPayload);
          }
        } catch {
          state.dirty = true;
        }
      }
    }
  }

  await next();

  if (state.destroyed) {
    if (state.loadedSessionId) {
      await cache?.delete?.(buildSessionCacheKey(middlewareContext, state.loadedSessionId));
    }
    await syncSessionSnapshot?.({
      sessionId: null,
      sessionData: {}
    });
    return;
  }

  if (!state.dirty && !state.sessionId) {
    return;
  }

  if (!state.sessionId) {
    const generatedSessionId = middlewareContext.services?.generateSessionId?.();
    state.sessionId = typeof generatedSessionId === `string` && generatedSessionId.trim()
      ? generatedSessionId.trim()
      : null;
  }

  if (!state.sessionId) {
    return;
  }

  const sessionPayload = sanitizeSessionData(sessionData);
  await cache?.set?.(
    buildSessionCacheKey(middlewareContext, state.sessionId),
    JSON.stringify(sessionPayload),
    SESSION_CACHE_TTL_SECONDS
  );
  await syncSessionSnapshot?.({
    sessionId: state.sessionId,
    sessionData: sessionPayload
  });
};

function resolveWsSessionId(middlewareContext) {
  const explicitSessionId = middlewareContext?.wsMessageData?.metadata?.sessionId;
  if (typeof explicitSessionId === `string` && explicitSessionId.trim()) {
    return explicitSessionId.trim();
  }

  const cookieHeader = middlewareContext?.wsMessageData?.metadata?.headers?.cookie ?? null;
  return cookieParse(cookieHeader).session ?? null;
}

function cookieParse(cookieHeader) {
  const cookies = {};

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  const pairs = cookieHeader.split(';');

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const index = pair.indexOf('=');

    if (index === -1) continue;

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    if (!key) continue;

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
};
