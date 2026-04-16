'use strict';

const path = require(`path`);
const { runAsyncCacheTask } = require(`@/utils/cache/cache-async`);
const { enforceTenantDiskLimit } = require(`@/utils/storage/tenant-disk-limit`);

module.exports = async function runMiddleware(executionContext, next) {
  const forward = createFlowController(next);
  if (!isCacheableRoute(executionContext)) {
    return forward.continue();
  }

  const cacheArtifactPath = resolveCacheArtifactPath(executionContext);
  if (!cacheArtifactPath) {
    return forward.continue();
  }

  const body = serializeCacheBody(getBody(executionContext));
  if (body == null) {
    return forward.continue();
  }
  const pendingWriteBytes = resolveBodyBytes(body);

  const diskLimitResult = await enforceTenantDiskLimit({
    storage: executionContext.services.storage,
    tenantRoute: executionContext.tenantRoute,
    middlewareStackOrchestratorConfig: executionContext.middlewareStackOrchestratorConfig,
    pendingWriteBytes,
    contextLabel: `response_cache_disk_limit`
  });
  if (!diskLimitResult.allowed) {
    return forward.continue();
  }

  const asyncTimeoutMs = Number(
    executionContext.middlewareStackOrchestratorConfig?.responseCacheAsyncTimeoutMs
      ?? 1500
  );
  const cacheTtl = resolveCacheTtl(executionContext.tenantRoute.cache);
  runAsyncCacheTask({
    channel: `response_cache`,
    operation: `materialize`,
    timeoutMs: asyncTimeoutMs,
    details: { url: executionContext.requestData?.url ?? null, cacheArtifactPath },
    execute: async () => {
      await executionContext.services.storage.createFolder(path.dirname(cacheArtifactPath));
      await executionContext.services.storage.writeFile(cacheArtifactPath, body);
      await executionContext.services.cache.set(
        `validResponseCache:${executionContext.requestData.url}`,
        cacheArtifactPath,
        cacheTtl
      );
    }
  });

  return forward.continue();
};

function isCacheableRoute(executionContext) {
  const { tenantRoute, requestData } = executionContext;
  if (!tenantRoute?.target?.run?.action) return false;
  if (tenantRoute.cache === `no-cache`) return false;
  if (tenantRoute.session) return false;
  if (![ `GET`, `HEAD` ].includes(requestData?.method ?? `GET`)) return false;
  if (getStatus(executionContext) && getStatus(executionContext) !== 200) return false;
  if (getCookies(executionContext)) return false;

  const body = getBody(executionContext);
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

function resolveCacheArtifactPath(executionContext) {
  const { tenantRoute, requestData } = executionContext;
  const basePath = tenantRoute.getCacheFilePath(requestData.url);
  if (!basePath) return null;

  const headerContentType = findHeader(getHeaders(executionContext), `content-type`);
  const extension = resolveExtension(headerContentType, getBody(executionContext));
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

function resolveCacheTtl(cacheValue) {
  const ttl = Number(cacheValue);
  if (!Number.isFinite(ttl) || ttl <= 0) return undefined;
  return ttl;
}

function resolveBodyBytes(body) {
  if (Buffer.isBuffer(body)) return body.byteLength;
  return Buffer.byteLength(String(body));
}

function getBody(executionContext) {
  return typeof executionContext?.getBody === `function`
    ? executionContext.getBody()
    : executionContext?.responseData?.body;
}

function getStatus(executionContext) {
  return typeof executionContext?.getStatus === `function`
    ? executionContext.getStatus()
    : executionContext?.responseData?.status;
}

function getHeaders(executionContext) {
  return typeof executionContext?.getHeaders === `function`
    ? executionContext.getHeaders()
    : executionContext?.responseData?.headers;
}

function getCookies(executionContext) {
  return typeof executionContext?.getCookies === `function`
    ? executionContext.getCookies()
    : executionContext?.responseData?.cookie;
}

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}
