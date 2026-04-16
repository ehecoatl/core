// adapters/engine/request-pipeline/default-pipeline/stages/local-file-stream-stage.js


'use strict';

const mime = require(`mime-types`);
const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const { createQueueOverloadResponse } = require(`@/utils/http/request-overload-response`);

/** @param {import('g@/engine/request-pipeline/stage-context')} stageContext  */
module.exports = async function runStage(stageContext) {
  const { tenantRoute, services, requestData } = stageContext;
  const { cache } = services;

  // CHECK FOR STATIC ASSET STREAM - NO PROCESSING
  if (tenantRoute.isStaticAsset()) {
    const assetPath = tenantRoute.assetPath();
    const streamed = await tryStreamStaticAssetWithQueue(stageContext, assetPath);
    if (streamed) return false;

    applyResponse(stageContext, createTenantFacingErrorResponse({
      status: 404,
      productionBody: `Not Found`,
      nonProductionBody: `Static asset route resolved, but the target file was not found in this non-production environment.`,
      nonProductionDetails: [
        `Asset path: ${assetPath}`
      ]
    }));
    return false;
  } else if (tenantRoute.cache !== `no-cache`) {
    const cacheKey = `validResponseCache:${requestData.url}`;

    // CHECK CACHE - NOT VALID AFTER TTL > REWRITE
    const cachePath = await cache.get(cacheKey, null);
    if (cachePath) {
      const streamed = await tryStreamStaticAssetWithQueue(stageContext, cachePath);
      if (streamed) {
        if (stageContext.meta) {
          stageContext.meta.cached = true;
        }
        return false;
      }
      if (typeof cache.delete === `function`) {
        await cache.delete(cacheKey);
      }
    } else {/* WAIT IF SOMEONE IS PRODUCING CACHE, AND RECHECK WHEN DONE */

      const queueLabel = cacheKey;
      const maxConcurrent = 1;
      const waitTimeoutMs = 10000;
      const task = await stageContext.askManager(
        `queue`,
        { queueLabel, maxConcurrent, waitTimeoutMs }
      );
      if (task?.success === false) {
        return true;
      }
      if (task && !task.first) {
        await stageContext.askManager(`dequeue`, {
          queueLabel,
          taskId: task.taskId
        });
        return module.exports(stageContext);
      }
      if (task?.taskId) {
        stageContext.addFinishCallback(() => {
          return stageContext.askManager(`dequeue`, {
            queueLabel,
            taskId: task.taskId
          });
        });
      }

    }
  }

  // FALLBACK - KEEP PIPELINE
  return true;
}

async function tryStreamStaticAsset(stageContext, path) {
  const { storage } = stageContext.services;
  const requestHeaders = stageContext.requestData?.headers ?? {};
  try {
    const exists = await storage.fileExists(path);
    if (!exists) return false;

    const stats = typeof storage.fileStat === `function`
      ? await storage.fileStat(path)
      : null;
    const mtimeMs = Number(stats?.mtimeMs);
    const hasMtime = Number.isFinite(mtimeMs);
    if (hasMtime) {
      stageContext.setHeader(`Last-Modified`, new Date(mtimeMs).toUTCString());
    }

    const ifModifiedSince = getHeaderValue(requestHeaders, `if-modified-since`);
    if (ifModifiedSince && hasMtime && isNotModified(mtimeMs, ifModifiedSince)) {
      stageContext.setStatus(304);
      stageContext.setBody(null);
      return true;
    }

    const readStream = await storage.readStream(path);
    const contentType = mime.lookup(path);
    if (contentType) {
      stageContext.setHeader(`Content-Type`, contentType);
    }
    stageContext.setBody(readStream);
    return true;
  } catch {
    return false;
  }
}

async function tryStreamStaticAssetWithQueue(stageContext, path) {
  const queueTask = await acquireStaticQueueTask(stageContext);
  if (queueTask?.success === false) {
    applyResponse(stageContext, createStaticOverloadResponse({
      task: queueTask,
      queueConfig: stageContext.requestPipelineConfig?.queue ?? {},
      tenantHost: stageContext.tenantRoute?.host
    }));
    return true;
  }

  if (queueTask?.taskId || queueTask?.taskId === 0) {
    stageContext.addFinishCallback(() => {
      return stageContext.askManager(`dequeue`, queueTask);
    });
  }

  return tryStreamStaticAsset(stageContext, path);
}

async function acquireStaticQueueTask(stageContext) {
  const queueConfig = stageContext.requestPipelineConfig?.queue ?? {};
  const tenantHost = stageContext.tenantRoute?.host ?? null;
  if (!tenantHost) return null;

  const maxConcurrent = queueConfig.staticMaxConcurrent
    ?? queueConfig.perTenantMaxConcurrent
    ?? 5;
  const waitTimeoutMs = queueConfig.staticWaitTimeoutMs
    ?? queueConfig.waitTimeoutMs
    ?? 1000;
  const queueLabel = `staticQueue:${tenantHost}`;

  return stageContext.askManager(`queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });
}

function createStaticOverloadResponse({
  task,
  queueConfig,
  tenantHost
}) {
  const retryAfterMs = queueConfig.retryAfterMs ?? 500;
  const queueLabel = task.queueLabel ?? `staticQueue:${tenantHost}`;
  const waitTimeoutMs = queueConfig.staticWaitTimeoutMs
    ?? queueConfig.waitTimeoutMs
    ?? 1000;

  if (task.reason === `queue_wait_timeout`) {
    return createQueueOverloadResponse({
      status: 504,
      retryAfterMs,
      productionBody: `Gateway Timeout`,
      nonProductionBody: `Request waited too long in the static queue for this non-production environment.`,
      nonProductionDetails: [
        `Tenant host: ${tenantHost}`,
        `Queue label: ${queueLabel}`,
        `Queue wait timeout: ${waitTimeoutMs}ms`
      ]
    });
  }

  return createQueueOverloadResponse({
    status: 503,
    retryAfterMs,
    productionBody: `Service Unavailable`,
    nonProductionBody: `Static queue is saturated in this non-production environment.`,
    nonProductionDetails: [
      `Tenant host: ${tenantHost}`,
      `Queue label: ${queueLabel}`,
      ...(Number.isFinite(task.maxWaiting) ? [`Queue max waiting slots: ${task.maxWaiting}`] : [])
    ]
  });
}

function getHeaderValue(headers, key) {
  const expected = String(key).toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers ?? {})) {
    if (String(headerName).toLowerCase() === expected) {
      return headerValue;
    }
  }
  return null;
}

function isNotModified(mtimeMs, ifModifiedSinceValue) {
  const modifiedSinceMs = Date.parse(String(ifModifiedSinceValue));
  if (!Number.isFinite(modifiedSinceMs)) return false;

  // HTTP-date precision is seconds; normalize both values for consistent 304 checks.
  return Math.floor(mtimeMs / 1000) <= Math.floor(modifiedSinceMs / 1000);
}

function applyResponse(stageContext, response) {
  stageContext.setStatus(response.status);
  stageContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    stageContext.setHeader(key, value);
  }
}
