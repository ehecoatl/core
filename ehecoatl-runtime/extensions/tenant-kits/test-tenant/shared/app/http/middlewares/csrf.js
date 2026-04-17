'use strict';

const {
  isSafeMethod,
  getCsrfCandidate
} = require(`../../utils/_security-support`);

module.exports = async function csrfMiddleware(middlewareContext, next) {
  const sessionData = middlewareContext.sessionData ?? {};
  const method = middlewareContext.requestData?.method ?? `GET`;

  if (!sessionData.csrfToken && typeof sessionData.regenerateCsrfToken === `function`) {
    sessionData.regenerateCsrfToken();
  }

  if (isSafeMethod(method)) {
    await next();
    return;
  }

  const candidate = getCsrfCandidate(middlewareContext);
  if (!candidate || candidate !== sessionData.csrfToken) {
    middlewareContext.setStatus(403);
    middlewareContext.setHeader(`Content-Type`, `application/json`);
    middlewareContext.setBody({
      success: false,
      error: `csrf_invalid`
    });
    return;
  }

  await next();
};
