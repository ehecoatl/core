'use strict';

const { createQueueOverloadResponse } = require(`@/utils/http/request-overload-response`);

module.exports = async function runMiddleware(executionContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute } = executionContext;
  if (!tenantRoute?.target?.run?.action) {
    return forward.continue();
  }

  const queueConfig = executionContext.middlewareStackOrchestratorConfig?.queue ?? {};
  const tenantHost = tenantRoute.origin?.hostname;
  const queueLabel = `actionQueue:${tenantHost}`;
  const maxConcurrent = queueConfig.actionMaxConcurrent
    ?? queueConfig.perTenantMaxConcurrent
    ?? 5;
  const waitTimeoutMs = queueConfig.actionWaitTimeoutMs
    ?? queueConfig.waitTimeoutMs
    ?? 1000;
  const retryAfterMs = queueConfig.retryAfterMs ?? 500;

  const task = await askDirector(executionContext, `queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });

  if (task?.success === false) {
    applyResponse(executionContext, createOverloadResponse({
      task,
      retryAfterMs,
      tenantHost,
      waitTimeoutMs,
      maxConcurrent
    }));
    return forward.break();
  }

  executionContext.addFinishCallback(() => {
    return askDirector(executionContext, `dequeue`, task);
  });

  return forward.continue();
};

function createOverloadResponse({
  task,
  retryAfterMs,
  tenantHost,
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
        `Queue label: ${task.queueLabel ?? `actionQueue:${tenantHost}`}`
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
      `Queue label: ${task.queueLabel ?? `actionQueue:${tenantHost}`}`,
      `Per-tenant max concurrent: ${maxConcurrent}`,
      ...(Number.isFinite(task.maxWaiting) ? [`Queue max waiting slots: ${task.maxWaiting}`] : [])
    ]
  });
}

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

function askDirector(executionContext, question, data) {
  if (typeof executionContext?.askDirector === `function`) {
    return executionContext.askDirector(question, data);
  }
  if (typeof executionContext?.askManager === `function`) {
    return executionContext.askManager(question, data);
  }
  return executionContext?.directorHelper?.askDirector(question, data);
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
