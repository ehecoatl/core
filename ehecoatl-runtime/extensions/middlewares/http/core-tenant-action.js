'use strict';

const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const { buildIsolatedRuntimeLabel } = require(`@/utils/process-labels`);

module.exports = async function runMiddleware(middlewareContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute, requestData, sessionData, services } = middlewareContext;

  if (!tenantRoute.target?.run?.action) {
    return forward.continue();
  }
  if (middlewareContext.meta) {
    middlewareContext.meta.action = true;
  }

  const tenantProcessLabel = resolveTenantProcessLabel(middlewareContext);
  const retryPolicy = resolveRetryPolicy(middlewareContext);
  let rpcResponse = null;
  let attempt = 0;
  while (rpcResponse == null) {
    try {
      rpcResponse = await askTenantAction({
        tenantProcessLabel,
        tenantRoute,
        requestData,
        sessionData,
        meta: middlewareContext.meta,
        services
      });
    } catch (error) {
      if (!shouldRetryTransportFailure({
        requestData,
        retryPolicy,
        attempt
      })) {
        applyResponse(executionContext, createTenantFacingErrorResponse({
          status: 502,
          productionBody: `Bad Gateway`,
          nonProductionBody: `Tenant action is unavailable in this non-production environment. See runtime logs for details.`
        }));
        return forward.break();
      }

      attempt += 1;
      await waitForRetry(retryPolicy.retryDelayMs);
    }
  }

  applyActionMeta(middlewareContext, rpcResponse?.internalMeta);

  const response = rpcResponse?.data;
  if (response && typeof response === `object`) {
    if (response.success === false) {
      middlewareContext.setStatus(response.status ?? 502);
      middlewareContext.setBody(Object.prototype.hasOwnProperty.call(response, `body`)
        ? response.body
        : `Bad Gateway`);
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          middlewareContext.setHeader(key, value);
        }
      }
      if (response.cookie) {
        for (const [key, value] of Object.entries(response.cookie)) {
          middlewareContext.setCookie(key, value);
        }
      }
      return forward.continue();
    }
    if (response.status) middlewareContext.setStatus(response.status);
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        middlewareContext.setHeader(key, value);
      }
    }
    if (response.cookie) {
      for (const [key, value] of Object.entries(response.cookie)) {
        middlewareContext.setCookie(key, value);
      }
    }
    if (Object.prototype.hasOwnProperty.call(response, `body`)) {
      middlewareContext.setBody(response.body);
    }
  } else if (response !== undefined) {
    middlewareContext.setBody(response);
  } else {
    applyResponse(middlewareContext, createTenantFacingErrorResponse({
      status: 502,
      productionBody: `Bad Gateway`,
      nonProductionBody: `Tenant action returned no response in this non-production environment. See runtime logs for details.`
    }));
  }

  return forward.continue();
};

async function askTenantAction({
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
      question: `tenantAction`,
      data: { tenantRoute, requestData, sessionData },
      internalMeta
    });
  }

  return {
    data: await services.rpc.ask({
      target: tenantProcessLabel,
      question: `tenantAction`,
      data: { tenantRoute, requestData, sessionData },
      internalMeta
    }),
    internalMeta: null
  };
}

function resolveTenantProcessLabel(middlewareContext) {
  const tenantId = middlewareContext.tenantRoute?.origin?.tenantId ?? null;
  const appId = middlewareContext.tenantRoute?.origin?.appId ?? null;
  if (tenantId && appId) {
    return buildIsolatedRuntimeLabel({
      tenantId,
      appId
    });
  }

  return middlewareContext.tenantRoute?.origin?.hostname ?? `isolated-runtime`;
}

function resolveRetryPolicy(middlewareContext) {
  const config = middlewareContext.middlewareStackRuntimeConfig?.actionRetryOnProcessRespawn ?? {};
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

function applyResponse(middlewareContext, response) {
  middlewareContext.setStatus(response.status);
  middlewareContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    middlewareContext.setHeader(key, value);
  }
}

function applyActionMeta(middlewareContext, internalMeta) {
  const actionMeta = internalMeta?.actionMeta;
  if (!actionMeta || !middlewareContext.meta) return;

  middlewareContext.meta.actionMeta = {
    coldWaitMs: normalizeMs(actionMeta.coldWaitMs, 0),
    actionMs: normalizeMs(actionMeta.actionMs, null)
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

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}
