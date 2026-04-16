'use strict';

const path = require(`node:path`);

const INTERNAL_STATIC_PREFIX = `/_ehecoatl_internal/static/`;
const INTERNAL_CACHE_PREFIX = `/_ehecoatl_internal/cache/`;

function buildNginxInternalRedirectInstruction(uri) {
  const normalizedUri = normalizeInternalUri(uri);
  return Object.freeze({
    __ehecoatlBodyKind: `nginx-internal-redirect`,
    uri: normalizedUri
  });
}

async function createStaticAssetInternalRedirect(context, targetPath) {
  const assetsRoot = String(context?.tenantRoute?.folders?.assetsRootFolder ?? ``).trim();
  const tenantRoot = String(
    context?.tenantRoute?.folders?.tenantRootFolder
    ?? context?.tenantRoute?.folders?.rootFolder
    ?? ``
  ).trim();
  if (!assetsRoot || !tenantRoot) return null;

  const safeAssetRelativePath = await resolveSafeRelativePath({
    storage: context?.services?.storage,
    absolutePath: targetPath,
    allowedRoot: assetsRoot
  });
  if (!safeAssetRelativePath) return null;

  const tenantRelativePath = resolveSafeRelativePathFromResolved({
    absolutePath: path.resolve(targetPath),
    allowedRoot: path.resolve(tenantRoot)
  });
  if (!tenantRelativePath) return null;

  return buildNginxInternalRedirectInstruction(`${INTERNAL_STATIC_PREFIX}${tenantRelativePath}`);
}

async function createResponseCacheInternalRedirect(context, targetPath) {
  const tenantRoot = String(context?.tenantRoute?.folders?.rootFolder ?? ``).trim();
  if (!tenantRoot) return null;

  const cacheRoot = path.join(tenantRoot, `.ehecoatl`, `.cache`);
  const safeCacheRelativePath = await resolveSafeRelativePath({
    storage: context?.services?.storage,
    absolutePath: targetPath,
    allowedRoot: cacheRoot
  });
  if (!safeCacheRelativePath) return null;

  return buildNginxInternalRedirectInstruction(`${INTERNAL_CACHE_PREFIX}${safeCacheRelativePath}`);
}

async function resolveSafeRelativePath({
  storage,
  absolutePath,
  allowedRoot
}) {
  if (!absolutePath || !allowedRoot) return null;

  const normalizedAbsolutePath = path.resolve(String(absolutePath));
  const normalizedAllowedRoot = path.resolve(String(allowedRoot));

  try {
    const exists = await storage.fileExists(normalizedAbsolutePath);
    if (!exists) return null;
  } catch {
    return null;
  }

  return resolveSafeRelativePathFromResolved({
    absolutePath: normalizedAbsolutePath,
    allowedRoot: normalizedAllowedRoot
  });
}

function resolveSafeRelativePathFromResolved({
  absolutePath,
  allowedRoot
}) {
  const relativePath = path.relative(allowedRoot, absolutePath);
  if (!relativePath || relativePath.startsWith(`..`) || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath.split(path.sep).join(`/`);
}

function normalizeInternalUri(uri) {
  const normalized = String(uri ?? ``).trim();
  if (!normalized.startsWith(`/`)) {
    throw new Error(`Internal redirect uri must start with "/"`);
  }
  return normalized;
}

module.exports = Object.freeze({
  INTERNAL_STATIC_PREFIX,
  INTERNAL_CACHE_PREFIX,
  buildNginxInternalRedirectInstruction,
  createStaticAssetInternalRedirect,
  createResponseCacheInternalRedirect
});
