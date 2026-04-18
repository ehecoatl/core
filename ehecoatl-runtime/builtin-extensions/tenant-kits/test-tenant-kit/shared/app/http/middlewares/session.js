'use strict';

const {
  SESSION_CACHE_TTL_SECONDS,
  buildSessionCacheKey,
  ensureSessionHelpers,
  sanitizeSessionData,
  setSessionCookie,
  expireSessionCookie,
  getSessionCookie,
  generateOpaqueToken
} = require(`../../utils/_security-support`);

module.exports = async function sessionMiddleware(middlewareContext, next) {
  const sessionData = middlewareContext.sessionData ?? {};
  const state = ensureSessionHelpers(middlewareContext);
  const cache = middlewareContext.services?.cache ?? null;

  if (state.sessionId == null) {
    const cookieSessionId = getSessionCookie(middlewareContext);
    if (cookieSessionId) {
      state.loadedSessionId = cookieSessionId;
      state.sessionId = cookieSessionId;
      const cachedPayload = await cache?.get?.(buildSessionCacheKey(middlewareContext, cookieSessionId), null) ?? null;
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

  if (!state.finishHookRegistered) {
    state.finishHookRegistered = true;
    middlewareContext.addFinishCallback(async () => {
      const currentCache = middlewareContext.services?.cache ?? null;
      if (state.destroyed) {
        if (state.loadedSessionId) {
          await currentCache?.delete?.(buildSessionCacheKey(middlewareContext, state.loadedSessionId));
        }
        expireSessionCookie(middlewareContext);
        return;
      }

      if (!state.dirty && !state.sessionId) {
        return;
      }

      if (!state.sessionId) {
        state.sessionId = generateOpaqueToken();
      }

      const sessionPayload = sanitizeSessionData(sessionData);
      await currentCache?.set?.(
        buildSessionCacheKey(middlewareContext, state.sessionId),
        JSON.stringify(sessionPayload),
        SESSION_CACHE_TTL_SECONDS
      );
      middlewareContext.requestData.cookie.session = state.sessionId;
      setSessionCookie(middlewareContext, state.sessionId);
    });
  }

  await next();
};
