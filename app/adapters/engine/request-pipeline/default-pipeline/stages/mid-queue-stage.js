// adapters/engine/request-pipeline/default-pipeline/stages/mid-queue-stage.js


'use strict';

const { createQueueOverloadResponse } = require(`@/utils/http/request-overload-response`);

/** QUEUE CONTROLLER REQUESTS PER HOST */

/** @param {import('g@/engine/request-pipeline/stage-context')} stageContext  */
module.exports = async function runStage(stageContext) {
  const { tenantRoute } = stageContext;
  if (!tenantRoute?.controller) return true;

  const queueConfig = stageContext.requestPipelineConfig?.queue ?? {};

  const queueLabel = `controllerQueue:${tenantRoute.host}`;
  const maxConcurrent = queueConfig.controllerMaxConcurrent
    ?? queueConfig.perTenantMaxConcurrent
    ?? 5;
  const waitTimeoutMs = queueConfig.controllerWaitTimeoutMs
    ?? queueConfig.waitTimeoutMs
    ?? 1000;
  const retryAfterMs = queueConfig.retryAfterMs ?? 500;

  const task = await stageContext.askManager(`queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });

  if (task?.success === false) {
    applyResponse(stageContext, createOverloadResponse({
      task,
      retryAfterMs,
      tenantHost: tenantRoute.host,
      waitTimeoutMs,
      maxConcurrent
    }));
    return false;
  }

  stageContext.addFinishCallback(() => {
    return stageContext.askManager(`dequeue`, task);
  });

  return true;
}

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
      nonProductionBody: `Request waited too long in the controller queue for this non-production environment.`,
      nonProductionDetails: [
        `Tenant host: ${tenantHost}`,
        `Queue wait timeout: ${waitTimeoutMs}ms`,
        `Queue label: ${task.queueLabel ?? `controllerQueue:${tenantHost}`}`
      ]
    });
  }

  return createQueueOverloadResponse({
    status: 503,
    retryAfterMs,
    productionBody: `Service Unavailable`,
    nonProductionBody: `Controller queue is saturated in this non-production environment.`,
    nonProductionDetails: [
      `Tenant host: ${tenantHost}`,
      `Queue label: ${task.queueLabel ?? `controllerQueue:${tenantHost}`}`,
      `Per-tenant max concurrent: ${maxConcurrent}`,
      ...(Number.isFinite(task.maxWaiting) ? [`Queue max waiting slots: ${task.maxWaiting}`] : [])
    ]
  });
}

function applyResponse(stageContext, response) {
  stageContext.setStatus(response.status);
  stageContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    stageContext.setHeader(key, value);
  }
}
