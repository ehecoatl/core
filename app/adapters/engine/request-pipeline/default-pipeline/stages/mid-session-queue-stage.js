// adapters/engine/request-pipeline/default-pipeline/stages/mid-session-queue-stage.js


'use strict';

const { createQueueOverloadResponse } = require(`@/utils/http/request-overload-response`);

/** @param {import('g@/engine/request-pipeline/stage-context')} stageContext */
module.exports = async function runStage(stageContext) {
  const { tenantRoute, requestData } = stageContext;
  if (!tenantRoute?.session) return true;

  const sessionId = requestData?.cookie?.session ?? null;
  if (!sessionId) return true;

  const queueConfig = stageContext.requestPipelineConfig?.queue ?? {};
  const queueLabel = `sessionQueue:${tenantRoute.host}:${sessionId}`;
  const maxConcurrent = queueConfig.perSessionMaxConcurrent ?? 1;
  const waitTimeoutMs = queueConfig.sessionWaitTimeoutMs
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
      queueLabel,
      waitTimeoutMs,
      retryAfterMs
    }));
    return false;
  }

  if (!task?.taskId && task?.taskId !== 0) return true;
  stageContext.addFinishCallback(() => stageContext.askManager(`dequeue`, task));
  return true;
};

function createOverloadResponse({
  task,
  queueLabel,
  waitTimeoutMs,
  retryAfterMs
}) {
  if (task.reason === `queue_wait_timeout`) {
    return createQueueOverloadResponse({
      status: 504,
      retryAfterMs,
      productionBody: `Gateway Timeout`,
      nonProductionBody: `Request waited too long in the session queue for this non-production environment.`,
      nonProductionDetails: [
        `Queue label: ${task.queueLabel ?? queueLabel}`,
        `Queue wait timeout: ${waitTimeoutMs}ms`
      ]
    });
  }

  return createQueueOverloadResponse({
    status: 503,
    retryAfterMs,
    productionBody: `Service Unavailable`,
    nonProductionBody: `Session queue is saturated in this non-production environment.`,
    nonProductionDetails: [
      `Queue label: ${task.queueLabel ?? queueLabel}`,
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
