'use strict';

module.exports = {
  index({ requestData, sessionData }) {
    return {
      status: 200,
      body: {
        success: true,
        authenticated: Boolean(sessionData?.auth),
        sessionId: requestData?.cookie?.session ?? null,
        csrfToken: sessionData?.csrfToken ?? null,
        auth: sessionData?.auth ?? null,
        scopes: Array.isArray(sessionData?.auth?.scopes) ? sessionData.auth.scopes : [],
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
