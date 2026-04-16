// adapters/engine/request-pipeline/default-pipeline/stages/tenant-controller-stage.js


'use strict';


const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);


/** @param {import('g@/engine/request-pipeline/stage-context')} stageContext  */
module.exports = async function runStage(stageContext) {
  const { tenantRoute, requestData, sessionData, services } = stageContext;

  if (!tenantRoute.controller) return true;
  if (stageContext.meta) {
    stageContext.meta.controller = true;
  }

  const tenantProcessLabel = `tenant_${tenantRoute.host}`;
  const retryPolicy = resolveRetryPolicy(stageContext);
  let rpcResponse = null;
  let attempt = 0;
  while (rpcResponse == null) {
    try {
      rpcResponse = await askTenantController({
        tenantProcessLabel,
        tenantRoute,
        requestData,
        sessionData,
        meta: stageContext.meta,
        services
      });
    } catch (error) {
      if (!shouldRetryTransportFailure({
        requestData,
        retryPolicy,
        attempt
      })) {
        applyResponse(stageContext, createTenantFacingErrorResponse({
          status: 502,
          productionBody: `Bad Gateway`,
          nonProductionBody: `Tenant controller is unavailable in this non-production environment. See runtime logs for details.`
        }));
        return false;
      }

      attempt += 1;
      await waitForRetry(retryPolicy.retryDelayMs);
    }
  }

  applyControllerMeta(stageContext, rpcResponse?.internalMeta);

  const response = rpcResponse?.data;
  if (response && typeof response === `object`) {
    if (response.success === false) {
      stageContext.setStatus(response.status ?? 502);
      stageContext.setBody(
        Object.prototype.hasOwnProperty.call(response, `body`)
          ? response.body
          : `Bad Gateway`
      );
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          stageContext.setHeader(key, value);
        }
      }
      if (response.cookie) {
        for (const [key, value] of Object.entries(response.cookie)) {
          stageContext.setCookie(key, value);
        }
      }
      return true;
    }
    if (response.status) stageContext.setStatus(response.status);
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        stageContext.setHeader(key, value);
      }
    }
    if (response.cookie) {
      for (const [key, value] of Object.entries(response.cookie)) {
        stageContext.setCookie(key, value);
      }
    }
    if (Object.prototype.hasOwnProperty.call(response, `body`)) {
      stageContext.setBody(response.body);
    }
  } else if (response !== undefined) {
    stageContext.setBody(response);
  } else {
    applyResponse(stageContext, createTenantFacingErrorResponse({
      status: 502,
      productionBody: `Bad Gateway`,
      nonProductionBody: `Tenant controller returned no response in this non-production environment. See runtime logs for details.`
    }));
  }

  return true;
}

async function askTenantController({
  tenantProcessLabel,
  tenantRoute,
  requestData,
  sessionData,
  meta,
  services
}) {
  const internalMeta = buildRequestInternalMeta(requestData, meta);
  if (typeof services.rpc.askDetailed === `function`) {
    return await services.rpc.askDetailed({
      target: tenantProcessLabel,
      question: `tenantController`,
      data: { tenantRoute, requestData, sessionData },
      internalMeta
    });
  }

  return {
    data: await services.rpc.ask({
      target: tenantProcessLabel,
      question: `tenantController`,
      data: { tenantRoute, requestData, sessionData },
      internalMeta
    }),
    internalMeta: null
  };
}

function resolveRetryPolicy(stageContext) {
  const config = stageContext.requestPipelineConfig?.controllerRetryOnProcessRespawn ?? {};
  const methods = Array.isArray(config.methods) && config.methods.length > 0
    ? config.methods
    : [`GET`, `HEAD`];

  return {
    enabled: config.enabled !== false,
    maxAttempts: Number.isInteger(config.maxAttempts) && config.maxAttempts >= 0
      ? config.maxAttempts
      : 1,
    retryDelayMs: Number.isFinite(config.retryDelayMs) && config.retryDelayMs >= 0
      ? config.retryDelayMs
      : 25,
    methods: methods.map((method) => String(method).toUpperCase())
  };
}

function shouldRetryTransportFailure({
  requestData,
  retryPolicy,
  attempt
}) {
  if (!retryPolicy.enabled) return false;
  if (attempt >= retryPolicy.maxAttempts) return false;

  const requestMethod = String(requestData?.method ?? `GET`).toUpperCase();
  return retryPolicy.methods.includes(requestMethod);
}

function waitForRetry(retryDelayMs) {
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, retryDelayMs);
    timeout.unref?.();
  });
}

function applyResponse(stageContext, response) {
  stageContext.setStatus(response.status);
  stageContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    stageContext.setHeader(key, value);
  }
}

function applyControllerMeta(stageContext, internalMeta) {
  const controllerMeta = internalMeta?.controllerMeta;
  if (!controllerMeta || !stageContext.meta) return;

  stageContext.meta.controllerMeta = {
    coldWaitMs: normalizeMs(controllerMeta.coldWaitMs, 0),
    controllerMs: normalizeMs(controllerMeta.controllerMs, null)
  };
}

function normalizeMs(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function buildRequestInternalMeta(requestData, meta) {
  const requestId = meta?.requestId ?? requestData?.requestId ?? null;
  const correlationId = meta?.correlationId ?? requestId;
  if (!requestId && !correlationId) return undefined;
  return {
    requestId,
    correlationId
  };
}
