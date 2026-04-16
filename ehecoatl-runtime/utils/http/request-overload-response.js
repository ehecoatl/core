// utils/http/request-overload-response.js


'use strict';


const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);

function createQueueOverloadResponse({
  status,
  retryAfterMs,
  productionBody,
  nonProductionBody,
  nonProductionDetails
}) {
  const response = createTenantFacingErrorResponse({
    status,
    productionBody,
    nonProductionBody,
    nonProductionDetails
  });

  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    response.headers = {
      ...(response.headers ?? {}),
      'Retry-After': toRetryAfterHttpDate(retryAfterMs)
    };
  }

  return response;
}

function toRetryAfterHttpDate(retryAfterMs) {
  return new Date(Date.now() + retryAfterMs).toUTCString();
}

module.exports = {
  createQueueOverloadResponse,
  toRetryAfterHttpDate
};

Object.freeze(module.exports);
