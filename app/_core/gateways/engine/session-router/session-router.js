// _core/gateways/engine/session-router/session-router.js


'use strict';

const GatewayCore = require(`g@/gateway-core`);

/** Engine gateway that resolves session state, CSRF validation, and response cookie updates. */
class SessionRouter extends GatewayCore {
  /** @type {import('g@/index').SharedCacheService} */
  sharedCacheService;

  /** @type {typeof import('@/config/default.config').sessionRouter} */
  config;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./session-router-adapter')} */
  adapter = null;

  /** Captures session config, shared cache access, and lazy adapter metadata for session routing. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.sessionRouter);
    this.config = kernelContext.config.sessionRouter;
    this.plugin = kernelContext.plugin;
    this.sharedCacheService = kernelContext.gateways.sharedCacheService;

    this.defaultCacheTTL = this.config.cacheTTL;
    super.loadAdapter();

    Object.freeze(this);
  }

  /** Normalizes request cookie input so session flows can safely handle missing headers. */
  #normalizeCookie(cookie) {
    return cookie && typeof cookie === `object` ? cookie : {};
  }

  /** Normalizes request-scoped session state into a mutable plain object. */
  #normalizeSessionData(sessionData) {
    return sessionData && typeof sessionData === `object` ? sessionData : {};
  }

  /** Validates the request CSRF token against the persisted session state. */
  async authCSRF({ tenantRoute, cookie }) {
    super.loadAdapter();
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.SESSION.AUTH_CSRF;
    const requestCookie = this.#normalizeCookie(cookie);
    const hookContext = { tenantRoute, cookie: requestCookie };

    await plugin.run(BEFORE, hookContext, ERROR);
    try {
      const { host } = tenantRoute;
      const requestCsrfToken = requestCookie.csrfToken ?? null;
      const sessionId = requestCookie.session ?? null;
      const sessionData = sessionId ? await this.#findSession(host, sessionId) : {};
      const authResult = await this.adapter.authCSRFAdapter({ sessionData, requestCsrfToken });
      await plugin.run(AFTER, { ...hookContext, sessionData, authResult }, ERROR);
      return authResult;
    } catch (error) {
      await plugin.run(ERROR, { ...hookContext, error });
      throw error;
    }
  }

  /** Resolves the persisted session payload for one tenant route and session cookie. */
  async getSessionData({ tenantRoute, cookie }) {
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.SESSION.GET_SESSION;
    const requestCookie = this.#normalizeCookie(cookie);
    const hookContext = { tenantRoute, cookie: requestCookie };

    await plugin.run(BEFORE, hookContext, ERROR);
    try {
      const { host } = tenantRoute;
      const sessionId = requestCookie.session ?? null;
      const sessionData = sessionId ? await this.#findSession(host, sessionId) : {};
      await plugin.run(AFTER, { ...hookContext, sessionData }, ERROR);
      return sessionData;
    } catch (error) {
      await plugin.run(ERROR, { ...hookContext, error });
      throw error;
    }
  }

  /** Produces response cookies and optionally persists the current request-owned session state. */
  async cookiesResponse({ tenantRoute, cookie, sessionData = undefined, persist = true }) {
    super.loadAdapter();
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.SESSION.UPDATE_COOKIE;
    const requestCookie = this.#normalizeCookie(cookie);
    const hookContext = { tenantRoute, cookie: requestCookie, sessionData };

    await plugin.run(BEFORE, hookContext, ERROR);
    try {
      const resolved = await this.#resolveSessionState({
        tenantRoute,
        cookie: requestCookie,
        sessionData
      });
      if (persist) {
        await this.#persistResolvedSessionState(resolved);
      }
      await plugin.run(AFTER, { ...hookContext, sessionData: resolved.sessionData, setCookie: resolved.setCookie }, ERROR);
      return resolved.setCookie;
    } catch (error) {
      await plugin.run(ERROR, { ...hookContext, error });
      throw error;
    }
  }

  /** Persists the request-owned session payload as the source of truth for the current request. */
  async setSessionData({ tenantRoute, cookie, sessionData }) {
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.SESSION.UPDATE_SESSION;
    const requestCookie = this.#normalizeCookie(cookie);
    const hookContext = { tenantRoute, cookie: requestCookie, sessionData };

    await plugin.run(BEFORE, hookContext, ERROR);
    try {
      if (!tenantRoute?.session) {
        await plugin.run(AFTER, { ...hookContext, updated: false }, ERROR);
        return false;
      }

      const resolved = await this.#resolveSessionState({
        tenantRoute,
        cookie: requestCookie,
        sessionData
      });
      await this.#persistResolvedSessionState(resolved);
      await plugin.run(AFTER, { ...hookContext, sessionData: resolved.sessionData, updated: true }, ERROR);
      return true;
    } catch (error) {
      await plugin.run(ERROR, { ...hookContext, error });
      throw error;
    }
  }

  /** Persists one session document into shared cache storage and emits session hooks. */
  async #updateSession(host, sessionId, sessionData) {
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.SESSION.CACHE_SET;
    const hookContext = { sessionId, sessionData, host };

    await plugin.run(BEFORE, hookContext, ERROR);
    try {
      const label = `session:${host}:${sessionId}`;
      const cached = await this.sharedCacheService.set(
        label,
        JSON.stringify(sessionData),
        this.defaultCacheTTL
      );
      const writeSucceeded = cached !== false;
      if (!writeSucceeded) {
        throw new Error(`shared_cache_write_failed`);
      }
      await plugin.run(AFTER, hookContext, ERROR);
      return true;
    } catch (error) {
      await plugin.run(ERROR, { ...hookContext, error });
      return false;
    }
  }

  /** Resolves stable session identity and session payload without consulting stale cache when live data is available. */
  async #resolveSessionState({ tenantRoute, cookie, sessionData = undefined }) {
    super.loadAdapter();
    const { host } = tenantRoute;
    const requestCookie = this.#normalizeCookie(cookie);
    const resolvedSessionData = sessionData === undefined
      ? ((requestCookie.session ?? null) ? await this.#findSession(host, requestCookie.session) : {})
      : this.#normalizeSessionData(sessionData);

    const setCookie = await this.adapter.cookiesResponseAdapter({
      sessionId: requestCookie.session ?? null,
      csrfToken: requestCookie.csrfToken ?? resolvedSessionData.csrfToken ?? null,
      tenantRoute
    });

    requestCookie.session = setCookie.session.value;
    requestCookie.csrfToken = setCookie.csrfToken.value;
    resolvedSessionData.csrfToken = setCookie.csrfToken.value;

    return {
      host,
      requestCookie,
      sessionData: resolvedSessionData,
      setCookie
    };
  }

  /** Persists one resolved request-owned session snapshot and escalates write failures. */
  async #persistResolvedSessionState({ host, sessionData, setCookie }) {
    const updated = await this.#updateSession(host, setCookie.session.value, sessionData);
    if (!updated) {
      throw new Error(`Failed to persist session data for host "${host}"`);
    }
  }

  /** Loads one session document from shared cache or creates an empty session payload. */
  async #findSession(host, sessionId) {
    const plugin = this.plugin;
    const cacheHooks = plugin.hooks.ENGINE.SESSION.CACHE_GET;
    const createHooks = plugin.hooks.ENGINE.SESSION.CREATE;
    const cacheHookContext = { host, sessionId };

    await plugin.run(cacheHooks.BEFORE, cacheHookContext, cacheHooks.ERROR);
    try {
      const label = `session:${host}:${sessionId}`;
      const cachedData = await this.sharedCacheService.get(label);
      let sessionData;
      if (cachedData) {
        sessionData = JSON.parse(cachedData);
        await plugin.run(cacheHooks.AFTER, { ...cacheHookContext, sessionData }, cacheHooks.ERROR);
        await this.#refreshSessionTtl(host, sessionId, sessionData);
      } else {
        await plugin.run(createHooks.BEFORE, cacheHookContext, createHooks.ERROR);
        sessionData = {};
        await plugin.run(createHooks.AFTER, { ...cacheHookContext, sessionData }, createHooks.ERROR);
        await plugin.run(cacheHooks.AFTER, { ...cacheHookContext, sessionData, cacheMiss: true }, cacheHooks.ERROR);
      }
      return sessionData;
    } catch (error) {
      await plugin.run(cacheHooks.ERROR, { ...cacheHookContext, error });
      return {};
    }
  }

  /** Refreshes session expiry on successful cache reads without failing the read path if refresh fails. */
  async #refreshSessionTtl(host, sessionId, sessionData) {
    await this.#updateSession(host, sessionId, sessionData);
  }

  /** Clears in-memory session state before delegating adapter teardown. */
  async destroy() {
    await super.destroy();
  }
}

module.exports = SessionRouter;
Object.freeze(module.exports);
