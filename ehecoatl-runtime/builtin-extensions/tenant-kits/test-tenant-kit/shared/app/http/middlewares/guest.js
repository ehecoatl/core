'use strict';

module.exports = async function guestMiddleware(middlewareContext, next) {
  if (middlewareContext.sessionData?.auth) {
    middlewareContext.setStatus(403);
    middlewareContext.setHeader(`Content-Type`, `application/json`);
    middlewareContext.setBody({
      success: false,
      error: `guest_only`
    });
    return;
  }

  await next();
};
