'use strict';

const crypto = require(`node:crypto`);
const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);

const COOKIE_MAX_AGE_SECONDS = 3600;

module.exports = {
  name: `session-runtime`,
  contexts: [`TRANSPORT`],
  priority: 20,

  /** @param {import('@/_core/orchestrators/plugin-orchestrator')} executor */
  async register(executor) {
    const pluginConfig = executor.getPluginConfig?.(this.name) ?? {};
    const lifecycle = createSessionRuntimeLifecycle({
      cacheTTL: pluginConfig.cacheTTL,
      path: pluginConfig.path
    });

    const transportHooks = executor.hooks?.TRANSPORT;
    if (transportHooks?.REQUEST?.BODY?.START) {
      executor.on(
        transportHooks.REQUEST.BODY.START,
        lifecycle.onRequestBodyStart,
        this.pluginMeta
      );
    }

    if (transportHooks?.MIDDLEWARE_STACK?.START) {
      executor.on(transportHooks.MIDDLEWARE_STACK.START, lifecycle.onMiddlewareStackStart, this.pluginMeta);
    }
    if (transportHooks?.MIDDLEWARE_STACK?.END) {
      executor.on(transportHooks.MIDDLEWARE_STACK.END, lifecycle.onMiddlewareStackEnd, this.pluginMeta);
    }
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  },

  _internal: {
    COOKIE_MAX_AGE_SECONDS,
    normalizeCookie,
    normalizeSessionData,
    normalizePath,
    createSessionCacheKey,
    createCookieResponse,
    validateCsrf,
    loadSessionData,
    persistSessionData,
    mergeResponseCookies,
    createSessionRuntimeLifecycle
  }
};

function normalizeCookie(cookie) {
  return cookie && typeof cookie === `object` ? cookie : {};
}

function normalizeSessionData(sessionData) {
  return sessionData && typeof sessionData === `object` ? sessionData : {};
}

function normalizePath(cookiePath) {
  if (typeof cookiePath !== `string`) return `/`;
  const trimmed = cookiePath.trim();
  if (!trimmed || trimmed === `session`) return `/`;
  return trimmed.startsWith(`/`) ? trimmed : `/${trimmed}`;
}

function createSessionCacheKey(hostname, sessionId) {
  return `session:${hostname}:${sessionId}`;
}

function createCookieResponse({
  sessionId = null,
  csrfToken = null,
  path = `/`
}) {
  const resolvedPath = normalizePath(path);
  return {
    csrfToken: {
      value: csrfToken ?? crypto.randomUUID(),
      httpOnly: true,
      secure: true,
      sameSite: `Lax`,
      path: resolvedPath,
      maxAge: COOKIE_MAX_AGE_SECONDS
    },
    session: {
      value: sessionId ?? crypto.randomUUID(),
      httpOnly: true,
      secure: true,
      sameSite: `Lax`,
      path: resolvedPath,
      maxAge: COOKIE_MAX_AGE_SECONDS
    },
  };
}

async function validateCsrf({
  cacheService,
  hostname,
  cookie
}) {
  const requestCookie = normalizeCookie(cookie);
  const requestCsrfToken = requestCookie.csrfToken ?? null;
  const sessionId = requestCookie.session ?? null;
  if (!sessionId || !requestCsrfToken) {
    return { success: false };
  }

  const sessionData = await loadSessionData({
    cacheService,
    hostname,
    cookie: requestCookie
  });

  return {
    success: sessionData?.csrfToken === requestCsrfToken
  };
}

async function loadSessionData({
  cacheService,
  hostname,
  cookie,
  cacheTTL
}) {
  const requestCookie = normalizeCookie(cookie);
  const sessionId = requestCookie.session ?? null;
  if (!hostname || !sessionId) return {};

  try {
    const cacheKey = createSessionCacheKey(hostname, sessionId);
    const cached = await cacheService.get(cacheKey);
    if (!cached) return {};

    const sessionData = normalizeSessionData(JSON.parse(cached));
    const ttl = Number(cacheTTL);
    if (Number.isFinite(ttl) && ttl > 0) {
      await cacheService.set(cacheKey, JSON.stringify(sessionData), ttl);
    }
    return sessionData;
  } catch {
    return {};
  }
}

async function persistSessionData({
  cacheService,
  hostname,
  cookie,
  sessionData,
  cacheTTL,
  path
}) {
  const requestCookie = normalizeCookie(cookie);
  const resolvedSessionData = normalizeSessionData(sessionData);
  const cookieBundle = createCookieResponse({
    sessionId: requestCookie.session ?? null,
    csrfToken: requestCookie.csrfToken ?? resolvedSessionData.csrfToken ?? null,
    path
  });

  requestCookie.session = cookieBundle.session.value;
  requestCookie.csrfToken = cookieBundle.csrfToken.value;
  resolvedSessionData.csrfToken = cookieBundle.csrfToken.value;

  const cacheKey = createSessionCacheKey(hostname, cookieBundle.session.value);
  const ttl = Number.isFinite(Number(cacheTTL)) && Number(cacheTTL) > 0
    ? Number(cacheTTL)
    : undefined;
  const persisted = await cacheService.set(
    cacheKey,
    JSON.stringify(resolvedSessionData),
    ttl
  );

  if (persisted === false) {
    throw new Error(`Failed to persist session data for hostname "${hostname}"`);
  }

  return {
    sessionData: resolvedSessionData,
    setCookie: cookieBundle
  };
}

function mergeResponseCookies(responseData, cookie) {
  if (!cookie || typeof cookie !== `object`) return;
  if (!responseData.cookie) {
    responseData.cookie = { ...cookie };
    return;
  }
  Object.assign(responseData.cookie, cookie);
}

function createSessionRuntimeLifecycle({
  cacheTTL = 3600000,
  path = `/`
} = {}) {
  return {
    async onRequestBodyStart(executionContext) {
      if (!executionContext?.tenantRoute?.session) return;

      try {
        const authResult = await validateCsrf({
          cacheService: executionContext.services?.cache,
          hostname: executionContext.tenantRoute?.origin?.hostname ?? null,
          cookie: executionContext.requestData?.cookie ?? {}
        });
        if (authResult.success === true) return;

        const response = createTenantFacingErrorResponse({
          status: 401,
          productionBody: `Unauthorized`,
          nonProductionBody: `Request was rejected because the CSRF token is missing or invalid.`
        });
        executionContext.responseData.status = response.status;
        executionContext.responseData.headers = {
          ...(executionContext.responseData.headers ?? {}),
          ...(response.headers ?? {})
        };
        executionContext.responseData.body = response.body;
        executionContext.abort();
      } catch {
        const response = createTenantFacingErrorResponse({
          status: 500,
          productionBody: `Internal Server Error`,
          nonProductionBody: `Session validation failed in this non-production environment. See runtime logs for details.`
        });
        executionContext.responseData.status = response.status;
        executionContext.responseData.headers = {
          ...(executionContext.responseData.headers ?? {}),
          ...(response.headers ?? {})
        };
        executionContext.responseData.body = response.body;
        executionContext.abort();
      }
    },

    async onMiddlewareStackStart(executionContext) {
      if (!executionContext?.tenantRoute?.session) {
        executionContext.sessionData = {};
        if (executionContext?.meta) executionContext.meta.session = false;
        return;
      }

        executionContext.meta.session = true;
        executionContext.sessionData = await loadSessionData({
          cacheService: executionContext.services?.cache,
          hostname: executionContext.tenantRoute?.origin?.hostname ?? null,
          cookie: executionContext.requestData?.cookie ?? {},
          cacheTTL
        });
    },

    async onMiddlewareStackEnd(executionContext) {
      if (!executionContext?.tenantRoute?.session || executionContext.isAborted?.()) {
        return;
      }

      try {
          const resolved = await persistSessionData({
            cacheService: executionContext.services?.cache,
            hostname: executionContext.tenantRoute?.origin?.hostname ?? null,
            cookie: executionContext.requestData?.cookie ?? {},
            sessionData: executionContext.sessionData,
            cacheTTL,
          path
        });
        executionContext.sessionData = resolved.sessionData;
        mergeResponseCookies(executionContext.responseData, resolved.setCookie);
      } catch (error) {
        const response = createTenantFacingErrorResponse({
          status: 500,
          productionBody: `Internal Server Error`,
          nonProductionBody: `Session persistence failed in this non-production environment. See runtime logs for details.`
        });
        executionContext.responseData.status = response.status;
        executionContext.responseData.headers = {
          ...(executionContext.responseData.headers ?? {}),
          ...(response.headers ?? {})
        };
        executionContext.responseData.body = response.body;
        executionContext.meta.sessionError = error?.message ?? String(error);
      }
    }
  };
}

Object.freeze(module.exports);
