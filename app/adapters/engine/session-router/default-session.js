// adapters/engine/session-router/default-session.js


'use strict';


const crypto = require('crypto');
const SessionRouterAdapter = require(`g@/engine/session-router/session-router-adapter`);

SessionRouterAdapter.authCSRFAdapter = async function ({
  sessionData,
  requestCsrfToken
}) {
  const success = sessionData && sessionData.csrfToken === requestCsrfToken;
  return { success };
};

SessionRouterAdapter.cookiesResponseAdapter = async function ({
  sessionId,
  csrfToken,
  tenantRoute
}) {
  return {
    csrfToken: {
      value: csrfToken ?? crypto.randomUUID(),
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 3600
    },
    session: {
      value: sessionId ?? crypto.randomUUID(),
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 3600
    },
  };
};

module.exports = SessionRouterAdapter;
Object.freeze(SessionRouterAdapter);
