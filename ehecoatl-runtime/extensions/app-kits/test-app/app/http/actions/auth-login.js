'use strict';

const { loadCredentials } = require(`./_credentials`);

module.exports = {
  async index({ requestData, sessionData, tenantRoute, services }) {
    const username = String(requestData?.body?.username ?? ``).trim();
    const password = String(requestData?.body?.password ?? ``);
    const credentials = await loadCredentials(tenantRoute, services);
    const matched = credentials[username] ?? null;

    if (!username || !matched || matched.password !== password) {
      return {
        status: 401,
        body: {
          success: false,
          error: `invalid_credentials`
        }
      };
    }

    sessionData.setAuth?.({
      user_id: matched.user_id,
      username,
      displayName: matched.displayName ?? null,
      scopes: Array.isArray(matched.scopes) ? matched.scopes : []
    });
    const csrfToken = typeof sessionData.regenerateCsrfToken === `function`
      ? sessionData.regenerateCsrfToken()
      : (sessionData.csrfToken ?? null);

    return {
      status: 200,
      body: {
        success: true,
        message: `login successful`,
        auth: sessionData.auth ?? null,
        csrfToken
      }
    };
  }
};

Object.freeze(module.exports);
