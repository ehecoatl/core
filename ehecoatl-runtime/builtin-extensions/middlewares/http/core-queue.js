'use strict';

const { createQueueOverloadResponse } = require(`@/utils/http/request-overload-response`);

module.exports = async function runMiddleware(middlewareContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute } = middlewareContext;
  if (!tenantRoute?.target?.run?.action) {
    return forward.continue();
  }

  const queueConfig = middlewareContext.middlewareStackRuntimeConfig?.queue ?? {};
  const tenantHost = tenantRoute.origin?.hostname;
  const queueLabel = resolveActionQueueLabel(tenantRoute);
  const maxConcurrent = queueConfig.actionMaxConcurrent
    ?? queueConfig.perTenantMaxConcurrent
    ?? 5;
  const waitTimeoutMs = queueConfig.actionWaitTimeoutMs
    ?? queueConfig.waitTimeoutMs
    ?? 1000;
  const retryAfterMs = queueConfig.retryAfterMs ?? 500;

  const task = await askDirector(middlewareContext, `queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });

  if (task?.success === false) {
    applyResponse(middlewareContext, createOverloadResponse({
      task,
      retryAfterMs,
      tenantHost,
      queueLabel,
      waitTimeoutMs,
      maxConcurrent
    }));
    return forward.break();
  }

  middlewareContext.addFinishCallback(() => {
    return askDirector(middlewareContext, `dequeue`, task);
  });

  return forward.continue();
};

function createOverloadResponse({
  task,
  retryAfterMs,
  tenantHost,
  queueLabel,
  waitTimeoutMs,
  maxConcurrent
}) {
  if (task.reason === `queue_wait_timeout`) {
    return createQueueOverloadResponse({
      status: 504,
      retryAfterMs,
      productionBody: `Gateway Timeout`,
      nonProductionBody: `Request waited too long in the action queue for this non-production environment.`,
      nonProductionDetails: [
        `Tenant host: ${tenantHost}`,
        `Queue wait timeout: ${waitTimeoutMs}ms`,
        `Queue label: ${task.queueLabel ?? queueLabel}`
      ]
    });
  }

  return createQueueOverloadResponse({
    status: 503,
    retryAfterMs,
    productionBody: `Service Unavailable`,
    nonProductionBody: `Action queue is saturated in this non-production environment.`,
    nonProductionDetails: [
      `Tenant host: ${tenantHost}`,
      `Queue label: ${task.queueLabel ?? queueLabel}`,
      `Per-app max concurrent: ${maxConcurrent}`,
      ...(Number.isFinite(task.maxWaiting) ? [`Queue max waiting slots: ${task.maxWaiting}`] : [])
    ]
  });
}

function resolveActionQueueLabel(tenantRoute) {
  const origin = tenantRoute?.origin ?? {};
  const tenantId = normalizeQueueSegment(origin.tenantId ?? tenantRoute?.tenantId);
  const appId = normalizeQueueSegment(origin.appId ?? tenantRoute?.appId);
  if (tenantId && appId) {
    return `actionQueue:${tenantId}:${appId}`;
  }

  const hostname = normalizeQueueSegment(origin.hostname) ?? `unknown-host`;
  const appSegment = normalizeQueueSegment(origin.appName)
    ?? normalizeQueueSegment(origin.appURL)
    ?? normalizeQueueSegment(tenantRoute?.appName);
  if (appSegment) {
    return `actionQueue:${hostname}:${appSegment}`;
  }

  return `actionQueue:${hostname}`;
}

function normalizeQueueSegment(value) {
  const normalized = String(value ?? ``).trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function applyResponse(middlewareContext, response) {
  middlewareContext.setStatus(response.status);
  middlewareContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    middlewareContext.setHeader(key, value);
  }
}

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}

function askDirector(middlewareContext, question, data) {
  if (typeof middlewareContext?.askDirector === `function`) {
    return middlewareContext.askDirector(question, data);
  }
  if (typeof middlewareContext?.askManager === `function`) {
    return middlewareContext.askManager(question, data);
  }
  throw new Error(`middleware-context requires askDirector for queue coordination`);
}
