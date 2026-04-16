'use strict';

const path = require(`path`);
const { runAsyncCacheTask } = require(`@/utils/cache/cache-async`);
const { enforceTenantDiskLimit } = require(`@/utils/storage/tenant-disk-limit`);
const { createResponseCacheInternalRedirect } = require(`./_static-stream-support`);

module.exports = async function runMiddleware(middlewareContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute, services, requestData } = middlewareContext;
  const { cache } = services;

  if (tenantRoute.isStaticAsset()) {
    return forward.continue();
  }
  if (tenantRoute.cache === `no-cache`) {
    return forward.continue();
  }

  const cacheKey = `validResponseCache:${requestData.url}`;
  const cachePath = await cache.get(cacheKey, null);
  if (cachePath) {
    const internalRedirect = await createResponseCacheInternalRedirect(middlewareContext, cachePath);
    if (internalRedirect) {
      middlewareContext.setBody(internalRedirect);
      if (middlewareContext.meta) {
        middlewareContext.meta.cached = true;
      }
      return forward.break();
    }
    if (typeof cache.delete === `function`) {
      await cache.delete(cacheKey);
    }
    return forward.continue();
  }

  const queueLabel = cacheKey;
  const maxConcurrent = 1;
  const waitTimeoutMs = 10000;
  const task = await askDirector(middlewareContext, `queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });
  if (task?.success === false) {
    return forward.continue();
  }
  if (task && !task.first) {
    await askDirector(middlewareContext, `dequeue`, {
      queueLabel,
      taskId: task.taskId
    });
    return module.exports(middlewareContext, next);
  }
  if (task?.taskId) {
    middlewareContext.addFinishCallback(() => {
      return askDirector(middlewareContext, `dequeue`, {
        queueLabel,
        taskId: task.taskId
      });
    });
  }

  const continueResult = await forward.continue();
  await materializeResponseCache(middlewareContext);
  return continueResult;
};

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
  throw new Error(`middleware-context requires askDirector for cache queue coordination`);
}

async function materializeResponseCache(middlewareContext) {
  if (!isCacheableRoute(middlewareContext)) {
    return;
  }

  const cacheArtifactPath = resolveCacheArtifactPath(middlewareContext);
  if (!cacheArtifactPath) {
    return;
  }

  const body = serializeCacheBody(middlewareContext.getBody());
  if (body == null) {
    return;
  }
  const pendingWriteBytes = resolveBodyBytes(body);

  const diskLimitResult = await enforceTenantDiskLimit({
    storage: middlewareContext.services.storage,
    tenantRoute: middlewareContext.tenantRoute,
    middlewareStackRuntimeConfig: middlewareContext.middlewareStackRuntimeConfig,
    pendingWriteBytes,
    contextLabel: `response_cache_disk_limit`
  });
  if (!diskLimitResult.allowed) {
    return;
  }

  const asyncTimeoutMs = Number(
    middlewareContext.middlewareStackRuntimeConfig?.responseCacheAsyncTimeoutMs
      ?? 1500
  );
  const cacheTtl = resolveCacheTtl(
    middlewareContext.tenantRoute.cache,
    middlewareContext.middlewareStackRuntimeConfig?.maxResponseCacheTTL
  );
  runAsyncCacheTask({
    channel: `response_cache`,
    operation: `materialize`,
    timeoutMs: asyncTimeoutMs,
    details: { url: middlewareContext.requestData?.url ?? null, cacheArtifactPath },
    execute: async () => {
      await middlewareContext.services.storage.createFolder(path.dirname(cacheArtifactPath));
      await middlewareContext.services.storage.writeFile(cacheArtifactPath, body);
      await middlewareContext.services.cache.set(
        `validResponseCache:${middlewareContext.requestData.url}`,
        cacheArtifactPath,
        cacheTtl
      );
    }
  });
}

function isCacheableRoute(middlewareContext) {
  const { tenantRoute, requestData } = middlewareContext;
  if (!tenantRoute?.target?.run?.action) return false;
  if (tenantRoute.cache === `no-cache`) return false;
  if (tenantRoute.session) return false;
  if ([`GET`, `HEAD`].includes(requestData?.method ?? `GET`) === false) return false;
  if (middlewareContext.getStatus() && middlewareContext.getStatus() !== 200) return false;
  if (middlewareContext.getCookies()) return false;

  const body = middlewareContext.getBody();
  if (body == null) return false;
  if (body && typeof body.pipe === `function`) return false;
  return true;
}

function serializeCacheBody(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === `string`) return body;
  if (body && typeof body === `object`) return JSON.stringify(body);
  if (body == null) return null;
  return String(body);
}

function resolveCacheArtifactPath(middlewareContext) {
  const { tenantRoute, requestData } = middlewareContext;
  const basePath = tenantRoute.getCacheFilePath(requestData.url);
  if (!basePath) return null;

  const headerContentType = findHeader(middlewareContext.getHeaders(), `content-type`);
  const extension = resolveExtension(headerContentType, middlewareContext.getBody());
  return `${basePath}${extension}`;
}

function findHeader(headers = {}, key) {
  const expected = String(key).toLowerCase();
  const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === expected);
  return entry?.[1] ?? null;
}

function resolveExtension(contentType, body) {
  if (typeof contentType === `string`) {
    const normalized = contentType.toLowerCase();
    if (normalized.includes(`application/json`)) return `.json`;
    if (normalized.includes(`text/html`)) return `.html`;
    if (normalized.includes(`text/plain`)) return `.txt`;
    if (normalized.includes(`text/css`)) return `.css`;
    if (normalized.includes(`javascript`)) return `.js`;
    if (normalized.includes(`image/svg+xml`)) return `.svg`;
  }

  if (body && typeof body === `object` && !Buffer.isBuffer(body)) return `.json`;
  return `.txt`;
}

function resolveCacheTtl(cacheValue, maxResponseCacheTTL) {
  const routeTtl = normalizePositiveTtl(cacheValue);
  const maxTtl = normalizePositiveTtl(maxResponseCacheTTL);

  if (routeTtl == null && maxTtl == null) return undefined;
  if (routeTtl == null) return maxTtl;
  if (maxTtl == null) return routeTtl;
  return Math.min(routeTtl, maxTtl);
}

function normalizePositiveTtl(value) {
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  return ttl;
}

function resolveBodyBytes(body) {
  if (Buffer.isBuffer(body)) return body.byteLength;
  return Buffer.byteLength(String(body));
}
