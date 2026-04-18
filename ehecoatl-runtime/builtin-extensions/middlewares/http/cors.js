'use strict';

const {
  getOriginHeader,
  isCrossOriginRequest,
  isOriginAllowed,
  buildCorsHeaders,
  buildCorsBlockedResponse
} = require(`@/utils/http/cors-policy`);

module.exports = async function corsMiddleware(middlewareContext, next) {
  const origin = getOriginHeader(middlewareContext);

  if (!origin || !isCrossOriginRequest(middlewareContext)) {
    await next();
    return;
  }

  if (!isOriginAllowed(middlewareContext, origin)) {
    const response = buildCorsBlockedResponse(middlewareContext, origin);
    middlewareContext.setStatus(response.status);
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      middlewareContext.setHeader(key, value);
    }
    middlewareContext.setBody(response.body);
    return;
  }

  const headers = buildCorsHeaders(middlewareContext, origin);
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) {
      middlewareContext.setHeader(key, value);
    }
  }

  await next();
};
