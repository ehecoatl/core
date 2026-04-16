'use strict';

const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const { createStaticAssetInternalRedirect } = require(`./_static-stream-support`);

module.exports = async function runMiddleware(executionContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute } = executionContext;
  if (!tenantRoute.isStaticAsset()) {
    return forward.continue();
  }

  const assetPath = tenantRoute.assetPath();
  const internalRedirect = await createStaticAssetInternalRedirect(executionContext, assetPath);
  if (internalRedirect) {
    setBody(executionContext, internalRedirect);
    return forward.break();
  }

  applyResponse(executionContext, createTenantFacingErrorResponse({
    status: 404,
    productionBody: `Not Found`,
    nonProductionBody: `Static asset route resolved, but the target file was not found in this non-production environment.`,
    nonProductionDetails: [
      `Asset path: ${assetPath}`
    ]
  }));
  return forward.break();
};

function applyResponse(executionContext, response) {
  setStatus(executionContext, response.status);
  setBody(executionContext, response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    setHeader(executionContext, key, value);
  }
}

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}

function setStatus(executionContext, status) {
  if (typeof executionContext?.setStatus === `function`) {
    executionContext.setStatus(status);
    return;
  }
  if (executionContext?.responseData) {
    executionContext.responseData.status = status;
  }
}

function setBody(executionContext, body) {
  if (typeof executionContext?.setBody === `function`) {
    executionContext.setBody(body);
    return;
  }
  if (executionContext?.responseData) {
    executionContext.responseData.body = body;
  }
}

function setHeader(executionContext, key, value) {
  if (typeof executionContext?.setHeader === `function`) {
    executionContext.setHeader(key, value);
    return;
  }
  if (executionContext?.responseData) {
    if (!executionContext.responseData.headers) {
      executionContext.responseData.headers = {};
    }
    executionContext.responseData.headers[key] = value;
  }
}
