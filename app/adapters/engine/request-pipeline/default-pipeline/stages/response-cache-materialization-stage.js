'use strict';

const path = require(`path`);
const { runAsyncCacheTask } = require(`@/utils/cache/cache-async`);
const { enforceTenantDiskLimit } = require(`@/utils/storage/tenant-disk-limit`);

/** @param {import('g@/engine/request-pipeline/stage-context')} stageContext  */
module.exports = async function runStage(stageContext) {
  const { tenantRoute, requestData, services } = stageContext;
  if (!isCacheableRoute(stageContext)) return true;

  const cacheArtifactPath = resolveCacheArtifactPath(stageContext);
  if (!cacheArtifactPath) return true;

  const body = serializeCacheBody(stageContext.getBody());
  if (body == null) return true;
  const pendingWriteBytes = resolveBodyBytes(body);

  const diskLimitResult = await enforceTenantDiskLimit({
    storage: services.storage,
    tenantRoute,
    requestPipelineConfig: stageContext.requestPipelineConfig,
    pendingWriteBytes,
    contextLabel: `response_cache_disk_limit`
  });
  if (!diskLimitResult.allowed) {
    return true;
  }

  const asyncTimeoutMs = Number(
    stageContext.requestPipelineConfig?.responseCacheAsyncTimeoutMs
      ?? 1500
  );
  const cacheTtl = resolveCacheTtl(tenantRoute.cache);
  runAsyncCacheTask({
    channel: `response_cache`,
    operation: `materialize`,
    timeoutMs: asyncTimeoutMs,
    details: { url: requestData?.url ?? null, cacheArtifactPath },
    execute: async () => {
      await services.storage.createFolder(path.dirname(cacheArtifactPath));
      await services.storage.writeFile(cacheArtifactPath, body);
      await services.cache.set(
        `validResponseCache:${requestData.url}`,
        cacheArtifactPath,
        cacheTtl
      );
    }
  });

  return true;
}

function isCacheableRoute(stageContext) {
  const { tenantRoute, requestData } = stageContext;
  if (!tenantRoute?.controller) return false;
  if (tenantRoute.cache === `no-cache`) return false;
  if (tenantRoute.session) return false;
  if (![ `GET`, `HEAD` ].includes(requestData?.method ?? `GET`)) return false;
  if (stageContext.getStatus() && stageContext.getStatus() !== 200) return false;
  if (stageContext.getCookies()) return false;

  const body = stageContext.getBody();
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

function resolveCacheArtifactPath(stageContext) {
  const { tenantRoute, requestData } = stageContext;
  const basePath = tenantRoute.getCacheFilePath(requestData.url);
  if (!basePath) return null;

  const headerContentType = findHeader(stageContext.getHeaders(), `content-type`);
  const extension = resolveExtension(headerContentType, stageContext.getBody());
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
