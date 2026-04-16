// _core/gateways/engine/network-engine/network2session-resolver.js


'use strict';


const NetworkEngine = require(`g@/engine/network-engine/network-engine`);

/** Engine-side resolver that bridges request execution with session-router services. */
class Network2SessionResolver {

  plugin;
  sessionRouter;

  /**
   * Captures engine-side service references used to coordinate session work.
   * @param {NetworkEngine} networkEngine
   */
  constructor(networkEngine) {
    this.plugin = networkEngine.plugin;
    this.sessionRouter = networkEngine.sessionRouter;

    Object.freeze(this);
  }

  /** Validates the current request CSRF token against the persisted session payload. */
  async authSessionCSRF(ec) {
    const { plugin, sessionRouter } = this;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.REQUEST.AUTH_CSRF;
    await plugin.run(BEFORE, ec, ERROR);
    try {
      const authResult = await sessionRouter.authCSRF({
        tenantRoute: ec.tenantRoute,
        cookie: ec.requestData.cookie
      });
      await plugin.run(AFTER, ec, ERROR);
      return authResult;
    } catch (error) {
      await plugin.run(ERROR, { ...ec, error });
      throw error;
    }
  }

  /** Loads request session state into the execution context when the route uses sessions. */
  async getSessionData(ec) {
    const { plugin, sessionRouter } = this;
    if (!ec.tenantRoute?.session) {
      ec.sessionData = {};
      return ec.sessionData;
    }

    if (ec.meta) {
      ec.meta.session = true;
    }

    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.REQUEST.GET_SESSION;
    await plugin.run(BEFORE, ec, ERROR);
    try {
      await this.#ensureSessionIdentity(ec);
      const sessionData = await sessionRouter.getSessionData({
        tenantRoute: ec.tenantRoute,
        cookie: ec.requestData.cookie
      });
      ec.sessionData = sessionData && typeof sessionData === `object`
        ? sessionData
        : {};
      await plugin.run(AFTER, ec, ERROR);
      return ec.sessionData;
    } catch (error) {
      await plugin.run(ERROR, { ...ec, error });
      throw error;
    }
  }

  /** Generates response cookies for the current session route and merges them into the response. */
  async setCookiesSession(ec) {
    const { plugin, sessionRouter } = this;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.RESPONSE.UPDATE_COOKIE;
    await plugin.run(BEFORE, ec, ERROR);
    try {
      const setCookie = await sessionRouter.cookiesResponse({
        tenantRoute: ec.tenantRoute,
        cookie: ec.requestData.cookie,
        sessionData: ec.sessionData,
        persist: false
      });
      if (!ec.responseData.cookie) ec.responseData.cookie = setCookie;
      else Object.assign(ec.responseData.cookie, setCookie);
      await plugin.run(AFTER, ec, ERROR);
    } catch (error) {
      await plugin.run(ERROR, { ...ec, error });
      throw error;
    }
  }

  /** Persists the execution-context session payload back through the session router. */
  async updateSessionData(ec) {
    const { plugin, sessionRouter } = this;
    const { BEFORE, AFTER, ERROR } = plugin.hooks.ENGINE.RESPONSE.UPDATE_SESSION;
    if (!ec.tenantRoute?.session) {
      return false;
    }
    await plugin.run(BEFORE, ec, ERROR);
    try {
      const updateResult = await sessionRouter.setSessionData({
        tenantRoute: ec.tenantRoute,
        cookie: ec.requestData.cookie,
        sessionData: ec.sessionData
      });
      await plugin.run(AFTER, ec, ERROR);
      return updateResult;
    } catch (error) {
      await plugin.run(ERROR, { ...ec, error });
      throw error;
    }
  }

  /** Ensures session routes always have a stable session id before queueing and controller execution. */
  async #ensureSessionIdentity(ec) {
    if (!ec.tenantRoute?.session) return;

    const requestCookie = ec.requestData?.cookie;
    if (!requestCookie || typeof requestCookie !== `object`) {
      ec.requestData.cookie = {};
    }

    if (ec.requestData.cookie?.session) return;

    const setCookie = await this.sessionRouter.cookiesResponse({
      tenantRoute: ec.tenantRoute,
      cookie: ec.requestData.cookie,
      sessionData: ec.sessionData ?? {},
      persist: false
    });

    if (!ec.responseData.cookie) ec.responseData.cookie = setCookie;
    else Object.assign(ec.responseData.cookie, setCookie);
  }
}

module.exports = Network2SessionResolver;
Object.freeze(module.exports);
