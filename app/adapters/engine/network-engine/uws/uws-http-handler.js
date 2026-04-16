// adapters/engine/network-engine/uws/uws-http-handler.js


'use strict';


const readBody = require(`./uws-http-read-body`);
const writeResponse = require(`./uws-http-write-response`);
const {
  corkIfAvailable,
  toStatusLine,
  writeUwsResponseHead
} = require(`@/utils/http/http-response-write`);
const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const createRateLimiterHttp = require(`@/utils/limiter/request-limiter-http`);
const { resolveRequestCorrelationId } = require(`@/utils/observability/request-correlation-id`);
const dataMethods = [`POST`, `PATCH`, `PUT`, `DELETE`];
const STATUS_TEXT = Object.freeze({
  400: `Bad Request`,
  401: `Unauthorized`,
  403: `Forbidden`,
  405: `Method Not Allowed`,
  413: `Payload Too Large`,
  415: `Unsupported Media Type`,
  422: `Unprocessable Content`,
  500: `Internal Server Error`
});

module.exports.setup = function ({
  app,
  getClientIp,
  createExecutionContext,
  networkConfig
}) {
  const httpLimiter = createRateLimiterHttp({
    capacity: networkConfig.limiter.capacity ?? 20,
    refillRateSeconds: networkConfig.limiter.time ?? 5
  });
  app.any("/*", async (res, req) => {
    const ip = getClientIp(req, res);
    httpLimiter(ip, res, async () => {
      const executionContext = createExecutionContext({ res, req, ip });
      const { run, hooks } = executionContext;
      const { REQUEST } = hooks;
      await run(REQUEST.LIMITER.BEFORE);
      await run(REQUEST.LIMITER.AFTER);
      await this.handle(executionContext);
      await executionContext.end();
    });
  });
}


/** @param {import('g@/engine/network-engine/execution/execution-context')} executionContext  */
module.exports.handle = async function (executionContext) {
  const { res, req, managerHelper } = executionContext;
  const { run, hooks } = executionContext;

  res.onAborted(() => executionContext.abort());

  await run(hooks.REQUEST.GET_COOKIE.BEFORE);
  try {
    const headers = extractHeaders(req);
    const correlation = resolveRequestCorrelationId(headers);
    await executionContext.setupRequestData({
      requestId: correlation.requestId,
      body: null,
      url: buildTenancyUrl(req, headers),
      query: req.getQuery(),
      method: req.getMethod(),
      headers
    });
    if (executionContext.meta) {
      executionContext.meta.requestId = correlation.requestId;
      executionContext.meta.correlationId = correlation.correlationId;
    }
    await run(hooks.REQUEST.GET_COOKIE.AFTER);
  } catch (error) {
    await run(hooks.REQUEST.GET_COOKIE.ERROR);
    throw error;
  }

  if (dataMethods.includes(executionContext.requestData?.method ?? `GET`)) {
    readBody.primeBufferedBody(executionContext);
  }

  try {
    await managerHelper.resolveRoute();
  } catch (error) {
    console.error(`[uws-http-handler] route resolution failed`, {
      url: executionContext.requestData?.url ?? null,
      host: executionContext.requestData?.headers?.host ?? null,
      error: error?.stack ?? error?.message ?? error
    });
    await writeInternalError(executionContext);
    return true;
  }

  if (!executionContext.tenantRoute) {
    executionContext.responseData.status = 404;
    executionContext.responseData.body = `Not Found`;
    await writeResponse(executionContext);
    return true;
  }

  if (executionContext.tenantRoute.isRedirect()) {
    executionContext.responseData.status = executionContext.tenantRoute.status ?? 302;
    executionContext.responseData.headers = {
      ...(executionContext.responseData.headers ?? {}),
      Location: executionContext.tenantRoute.redirect
    };
    await writeResponse(executionContext);
    return true;
  }

  const requestMethod = executionContext.requestData?.method ?? `GET`;
  const routeValidationFailure = validateRouteRequest(executionContext);
  if (routeValidationFailure) {
    executionContext.responseData.status = routeValidationFailure.status;
    executionContext.responseData.body = routeValidationFailure.body;
    executionContext.responseData.headers = {
      ...(executionContext.responseData.headers ?? {}),
      'Content-Type': `text/plain; charset=utf-8`,
      ...(routeValidationFailure.headers ?? {})
    };
    await writeResponse(executionContext);
    return true;
  }

  if (dataMethods.includes(requestMethod)) {
    const bodyReadStartedAt = Date.now();
    await run(hooks.REQUEST.BODY.START);
    try {
      await readBody(executionContext);
      await run(hooks.REQUEST.BODY.END);
      await runPipeline(executionContext);
    } catch (e) {
      await run(hooks.REQUEST.BODY.ERROR);
      await writeBodyReadFailure(executionContext, e);
    } finally {
      if (executionContext.meta) {
        executionContext.meta.bodyReadMs = Date.now() - bodyReadStartedAt;
      }
    }
  } else {
    await runPipeline(executionContext);
  }

  return true;
};

/** @param {import('g@/engine/network-engine/execution/execution-context')} executionContext  */
async function runPipeline(executionContext) {
  const { res, sessionHelper } = executionContext;
  const { run, hooks } = executionContext;

  if (executionContext.isAborted()) {
    await run(hooks.REQUEST.BREAK);
    return;
  }
  try {
    await sessionHelper.getSessionData();

    await executionContext.runHttpPipeline();

    if (executionContext.isAborted()) {
      await run(hooks.REQUEST.BREAK);
      return;
    }

    await sessionHelper.updateSessionData();

    await writeResponse(executionContext);
  } catch (error) {
    console.error(`[uws-http-handler] pipeline failed`, {
      url: executionContext.requestData?.url ?? null,
      host: executionContext.requestData?.headers?.host ?? null,
      error: error?.stack ?? error?.message ?? error
    });
    await run(hooks.REQUEST.ERROR);
    if (!executionContext.isAborted()) {
      const response = createTenantFacingErrorResponse({
        status: 500,
        productionBody: STATUS_TEXT[500],
        nonProductionBody: `Request execution failed in this non-production environment. See runtime logs for details.`
      });
      corkIfAvailable(res, () => {
        writeUwsResponseHead(res, {
          status: response.status,
          headers: response.headers
        });
        res.end(response.body);
      });
    }
  }

  return true;
}

/*
 * Helpers
 */

function extractHeaders(req) {
  const headers = {};
  req.forEach((key, value) => {
    headers[key] = value;
  });
  return headers;
}

function buildTenancyUrl(req, headers = {}) {
  const forwardedHost = headers[`x-forwarded-host`];
  const hostHeader = forwardedHost || headers.host || ``;
  const normalizedHost = hostHeader
    .split(`,`)[0]
    .trim()
    .replace(/:\d+$/, ``)
    .toLowerCase();

  const requestUrl = req.getUrl() || `/`;
  if (!normalizedHost) return requestUrl;
  return `${normalizedHost}${requestUrl.startsWith(`/`) ? requestUrl : `/${requestUrl}`}`;
}

function validateRouteRequest(executionContext) {
  const { requestData, tenantRoute } = executionContext;
  const requestMethod = requestData?.method ?? `GET`;

  if (!tenantRoute.allowsHostMethod(requestMethod)) {
    return {
      status: 405,
      body: STATUS_TEXT[405],
      headers: {
        Allow: tenantRoute.methodsAvailable.join(`, `)
      }
    };
  }

  if (!tenantRoute.allowsMethod(requestMethod)) {
    return {
      status: 405,
      body: STATUS_TEXT[405],
      headers: {
        Allow: tenantRoute.methods.join(`, `)
      }
    };
  }

  if (!shouldValidateContentType(requestData, tenantRoute)) {
    return null;
  }

  const requestContentType = requestData?.headers?.[`content-type`] ?? ``;
  if (tenantRoute.allowsContentType(requestContentType)) {
    return null;
  }

  return {
    status: 415,
    body: STATUS_TEXT[415]
  };
}

function shouldValidateContentType(requestData, tenantRoute) {
  if (!Array.isArray(tenantRoute.contentTypes)) return false;

  const headers = requestData?.headers ?? {};
  if (String(headers[`content-type`] ?? ``).trim()) return true;

  const contentLength = Number(headers[`content-length`]);
  if (Number.isFinite(contentLength) && contentLength > 0) return true;

  return String(headers[`transfer-encoding`] ?? ``).trim().length > 0;
}

async function writeBodyReadFailure(executionContext, error) {
  if (executionContext.isAborted()) return;

  const { res } = executionContext;
  const { status, body } = normalizeBodyReadError(error);
  corkIfAvailable(res, () => {
    writeUwsResponseHead(res, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
    res.end(body);
  });
}

function normalizeBodyReadError(error) {
  const normalizedString = normalizeStatusString(
    typeof error === `string`
      ? error
      : error?.message
  );
  if (normalizedString) {
    return createTenantFacingErrorResponse({
      status: normalizedString.status,
      productionBody: normalizedString.body,
      nonProductionBody: `Request body validation failed in this non-production environment.`,
      nonProductionDetails: [
        `Reason: ${normalizedString.body}`
      ]
    });
  }

  if (error instanceof SyntaxError) {
    return createTenantFacingErrorResponse({
      status: 400,
      productionBody: STATUS_TEXT[400],
      nonProductionBody: `Request body validation failed in this non-production environment.`,
      nonProductionDetails: [
        `Reason: invalid JSON body`,
        `Detail: ${error.message}`
      ]
    });
  }

  return createTenantFacingErrorResponse({
    status: 500,
    productionBody: STATUS_TEXT[500],
    nonProductionBody: `Request body validation failed in this non-production environment.`,
    nonProductionDetails: [
      `Reason: unexpected body-read failure`,
      ...(error?.message ? [`Detail: ${error.message}`] : [])
    ]
  });
}

function normalizeStatusString(value) {
  if (typeof value !== `string`) return null;
  const match = toStatusLine(value).match(/^(\d{3})\s+(.+)$/);
  if (!match) return null;

  const status = Number(match[1]);
  const body = match[2].trim();
  if (!Number.isInteger(status)) return null;

  return {
    status,
    body: body || (STATUS_TEXT[status] ?? STATUS_TEXT[500])
  };
}

async function writeInternalError(executionContext) {
  if (executionContext.isAborted()) return;

  const response = createTenantFacingErrorResponse({
    status: 500,
    productionBody: STATUS_TEXT[500],
    nonProductionBody: `Request routing failed in this non-production environment. See runtime logs for details.`
  });
  executionContext.responseData.status = response.status;
  executionContext.responseData.body = response.body;
  executionContext.responseData.headers = {
    ...(executionContext.responseData.headers ?? {}),
    ...(response.headers ?? {})
  };

  await writeResponse(executionContext);
}
