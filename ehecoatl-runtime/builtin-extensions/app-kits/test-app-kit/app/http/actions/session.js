'use strict';

module.exports = {
  index({ requestData, sessionData }) {
    const auth = sessionData.auth;
    if (auth) {
      const { user_id, scopes } = auth;
    }

    return {
      status: 200,
      body: {
        message: `session hello world`,
        sessionId: requestData?.cookie?.session ?? null,
        sessionData: sessionData ?? {},
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
