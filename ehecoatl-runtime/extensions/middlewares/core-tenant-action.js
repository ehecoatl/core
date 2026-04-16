'use strict';

const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const { buildIsolatedRuntimeLabel } = require(`@/utils/process-labels`);

module.exports = async function runMiddleware(executionContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute, requestData, sessionData, services } = executionContext;

  if (!tenantRoute.target?.run?.action) {
    return forward.continue();
  }
  if (executionContext.meta) {
    executionContext.meta.action = true;
  }

  const tenantProcessLabel = resolveTenantProcessLabel(executionContext);
  const retryPolicy = resolveRetryPolicy(executionContext);
  let rpcResponse = null;
  let attempt = 0;
  while (rpcResponse == null) {
    try {
      rpcResponse = await askTenantAction({
        tenantProcessLabel,
        tenantRoute,
        requestData,
        sessionData,
        meta: executionContext.meta,
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

  applyActionMeta(executionContext, rpcResponse?.internalMeta);

  const response = rpcResponse?.data;
  if (response && typeof response === `object`) {
    if (response.success === false) {
      setStatus(executionContext, response.status ?? 502);
      setBody(executionContext, Object.prototype.hasOwnProperty.call(response, `body`)
        ? response.body
        : `Bad Gateway`);
      if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
          setHeader(executionContext, key, value);
        }
      }
      if (response.cookie) {
        for (const [key, value] of Object.entries(response.cookie)) {
          setCookie(executionContext, key, value);
        }
      }
      return forward.continue();
    }
    if (response.status) setStatus(executionContext, response.status);
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        setHeader(executionContext, key, value);
      }
    }
    if (response.cookie) {
      for (const [key, value] of Object.entries(response.cookie)) {
        setCookie(executionContext, key, value);
      }
    }
    if (Object.prototype.hasOwnProperty.call(response, `body`)) {
      setBody(executionContext, response.body);
    }
  } else if (response !== undefined) {
    setBody(executionContext, response);
  } else {
    applyResponse(executionContext, createTenantFacingErrorResponse({
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

function resolveTenantProcessLabel(executionContext) {
  const tenantId = executionContext.tenantRoute?.origin?.tenantId ?? null;
  const appId = executionContext.tenantRoute?.origin?.appId ?? null;
  if (tenantId && appId) {
    return buildIsolatedRuntimeLabel({
      tenantId,
      appId
    });
  }

  return executionContext.tenantRoute?.origin?.hostname ?? `isolated-runtime`;
}

function resolveRetryPolicy(executionContext) {
  const config = executionContext.middlewareStackOrchestratorConfig?.actionRetryOnProcessRespawn ?? {};
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

function applyResponse(executionContext, response) {
  setStatus(executionContext, response.status);
  setBody(executionContext, response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    setHeader(executionContext, key, value);
  }
}

function applyActionMeta(executionContext, internalMeta) {
  const actionMeta = internalMeta?.actionMeta;
  if (!actionMeta || !executionContext.meta) return;

  executionContext.meta.actionMeta = {
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

function setCookie(executionContext, key, value) {
  if (typeof executionContext?.setCookie === `function`) {
    executionContext.setCookie(key, value);
    return;
  }
  if (executionContext?.responseData) {
    if (!executionContext.responseData.cookie) {
      executionContext.responseData.cookie = {};
    }
    executionContext.responseData.cookie[key] = value;
  }
}
