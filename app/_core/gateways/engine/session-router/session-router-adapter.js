// _core/gateways/engine/session-router/session-router-adapter.js


'use strict';


/** Contract singleton for session auth and cookie serialization adapter methods. */
class SessionRouterAdapter {
  /**
   * @type {(params: {
   * sessionData: { csrfToken?: string } | null,
   * requestCsrfToken?: string
   * }) => Promise<{ success: boolean }>}
   */
  authCSRFAdapter;
  /**
   * @type {(params: {
   * sessionId?: string | null,
   * csrfToken?: string | null,
   * tenantRoute: any
   * }) => Promise<{
   * csrfToken: { value: string, httpOnly: boolean, secure: boolean, sameSite: string, path: string, maxAge: number },
   * session: { value: string, httpOnly: boolean, secure: boolean, sameSite: string, path: string, maxAge: number }
   * }>}
   */
  cookiesResponseAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new SessionRouterAdapter();
Object.preventExtensions(module.exports);
