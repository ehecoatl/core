// _core/runtimes/ingress-runtime/execution/tenant-route-meta.js


'use strict';


const { normalizeRouteRunTarget } = require(`@/utils/tenancy/route-run-target`);
const { DEFAULT_REDIRECT_STATUS, parseRouteTargetString } = require(`@/utils/tenancy/route-target`);

const DEFAULT_METHODS = Object.freeze([`GET`]);
const LEGACY_ROUTE_TARGET_KEYS = Object.freeze([`run`, `asset`, `redirect`, `status`]);
const LEGACY_ROUTE_CONFIG_KEYS = Object.freeze([
  `resource`,
  `action`,
  `contentType`,
  `content-types`,
  `uploadPath`,
  `uploadTypes`,
  `diskLimit`,
  `diskLimitBytes`,
  `hostname`,
  `appURL`,
  `domain`,
  `appName`,
  `tenantRootFolder`,
  `rootFolder`,
  `actionsRootFolder`,
  `assetsRootFolder`,
  `httpMiddlewaresRootFolder`,
  `wsMiddlewaresRootFolder`,
  `routesRootFolder`
]);

class TenantRouteMeta {
  constructor(params = {}) {
    let normalizedParams = normalizeTenantRouteMetaParams(params);
    let {
      pointsTo,

      i18n,
      target,
      middleware,

      cache,
      session,

      methods = DEFAULT_METHODS,
      methodsAvailable = DEFAULT_METHODS,
      contentTypes,
      upload,
      maxInputBytes,

      origin,
      folders
    } = normalizedParams;

    this.pointsTo = typeof pointsTo === `string` && pointsTo.trim() ? pointsTo.trim() : null;
    this.i18n = i18n ?? null;
    this.target = freezeTarget(target);
    this.middleware = Object.freeze(normalizeMiddlewareLabels(middleware));

    this.cache = cache;
    this.session = session;

    this.methodsAvailable = Object.freeze(normalizeMethods(methodsAvailable));
    this.methods = Object.freeze(normalizeMethods(methods));
    this.contentTypes = normalizeContentTypes(contentTypes);
    this.upload = freezeUpload(upload);
    this.maxInputBytes = maxInputBytes;

    this.origin = freezeOrigin(origin);
    this.folders = freezeFolders(folders);

    Object.freeze(this);
  }

  static normalizeRouteConfig(routeValue, routePath = null) {
    if (!isPlainObject(routeValue)) {
      throw new Error(`Route "${routePath ?? `unknown`}" must resolve to a JSON object`);
    }

    const legacyKeys = [
      ...LEGACY_ROUTE_TARGET_KEYS,
      ...LEGACY_ROUTE_CONFIG_KEYS
    ].filter((key) => Object.prototype.hasOwnProperty.call(routeValue, key));
    if (legacyKeys.length > 0) {
      throw new Error(
        `Route "${routePath ?? `unknown`}" uses legacy target fields (${legacyKeys.join(`, `)}); use "pointsTo" only`
      );
    }
    if (typeof routeValue.pointsTo !== `string` || !routeValue.pointsTo.trim()) {
      throw new Error(`Route "${routePath ?? `unknown`}" must define a non-empty "pointsTo" string`);
    }

    return normalizeTenantRouteMetaParams(routeValue);
  }
}

function normalizeTenantRouteMetaParams(params) {
  let normalizedParams = { ...params };
  const parsedTarget = shouldParsePointsTo(normalizedParams)
    ? parseRouteTargetString(normalizedParams.pointsTo)
    : null;

  if (parsedTarget) {
    normalizedParams = {
      ...normalizedParams,
      pointsTo: parsedTarget.pointsTo,
      target: parsedTarget.target
    };
  }

  const normalizedTarget = resolveTarget(normalizedParams);

  const contentTypes = resolveContentTypes(normalizedParams);
  const middleware = resolveMiddleware(normalizedParams);
  const upload = resolveUpload(normalizedParams);
  const origin = resolveOrigin(normalizedParams);
  const folders = resolveFolders(normalizedParams, origin, upload);

  return {
    ...normalizedParams,
    contentTypes,
    middleware,
    upload,
    origin,
    folders,
    target: normalizedTarget
  };
}

function shouldParsePointsTo(params) {
  if (typeof params?.pointsTo !== `string` || !params.pointsTo.trim()) return false;
  return !isPlainObject(params?.target) || !params.target.type || !params.target.value;
}

function isPlainObject(value) {
  return value != null && typeof value === `object` && !Array.isArray(value);
}

function normalizeMethods(methods) {
  if (!Array.isArray(methods)) return [...DEFAULT_METHODS];

  return [...new Set(
    methods
      .map((method) => String(method ?? ``).trim().toUpperCase())
      .filter(Boolean)
  )];
}

function normalizeContentTypes(contentTypes) {
  if (!Array.isArray(contentTypes)) return null;

  return Object.freeze([...new Set(
    contentTypes
      .map((contentType) => normalizeContentType(contentType))
      .filter(Boolean)
  )]);
}

function normalizeRunGroup({
  run,
  targetType,
  targetValue,
  call
}) {
  if (isPlainObject(run)) {
    const resource = normalizeResourceIdentifier(run.resource);
    const action = normalizeActionIdentifier(run.action) ?? `index`;
    if (!resource) return null;
    return Object.freeze({ resource, action });
  }

  const runSource = typeof run === `string` && run.trim()
    ? run
    : (targetType === `run` ? targetValue : null);
  const target = normalizeRouteRunTarget({ run: runSource, call });
  if (!target.run || !target.resource || !target.action) return null;
  return Object.freeze({
    resource: target.resource,
    action: target.action
  });
}

function resolveTarget(params) {
  const normalizedTarget = isPlainObject(params?.target) ? params.target : {};
  const targetType = typeof normalizedTarget.type === `string` && normalizedTarget.type.trim()
    ? normalizedTarget.type.trim()
    : null;
  const targetValue = typeof normalizedTarget.value === `string` && normalizedTarget.value.trim()
    ? normalizedTarget.value.trim()
    : null;
  const run = normalizeRunGroup({
    run: normalizedTarget.run,
    targetType,
    targetValue,
    call: params.call
  });
  const assetPath = typeof normalizedTarget?.asset?.path === `string` && normalizedTarget.asset.path.trim()
    ? normalizedTarget.asset.path.trim()
    : (targetType === `asset` ? targetValue : null);
  const redirectLocation = typeof normalizedTarget?.redirect?.location === `string` && normalizedTarget.redirect.location.trim()
    ? normalizedTarget.redirect.location.trim()
    : (targetType === `redirect` ? targetValue : null);
  const redirectStatus = Number.isFinite(normalizedTarget?.redirect?.status)
    ? normalizedTarget.redirect.status
    : (targetType === `redirect` ? DEFAULT_REDIRECT_STATUS : null);

  return {
    type: targetType,
    value: targetValue,
    asset: assetPath ? { path: assetPath } : null,
    run,
    redirect: redirectLocation ? { location: redirectLocation, status: redirectStatus } : null
  };
}

function resolveContentTypes(params) {
  if (Object.prototype.hasOwnProperty.call(params, `contentTypes`)) {
    return params.contentTypes;
  }
  if (Object.prototype.hasOwnProperty.call(params, `content-types`)) {
    return params[`content-types`];
  }
  return null;
}

function resolveMiddleware(params) {
  if (Object.prototype.hasOwnProperty.call(params, `middleware`)) {
    return params.middleware;
  }
  if (Object.prototype.hasOwnProperty.call(params, `middlewares`)) {
    return params.middlewares;
  }
  return null;
}

function resolveUpload(params) {
  const upload = isPlainObject(params?.upload) ? params.upload : {};
  return {
    uploadPath: upload.uploadPath ?? params.uploadPath ?? null,
    uploadTypes: upload.uploadTypes ?? params.uploadTypes ?? null,
    diskLimit: upload.diskLimit ?? params.diskLimit ?? null,
    diskLimitBytes: upload.diskLimitBytes ?? params.diskLimitBytes ?? null
  };
}

function resolveOrigin(params) {
  const origin = isPlainObject(params?.origin) ? params.origin : {};
  return {
    hostname: origin.hostname ?? params.hostname ?? params.host ?? null,
    appURL: origin.appURL ?? params.appURL ?? null,
    domain: origin.domain ?? params.domain ?? null,
    appName: origin.appName ?? params.appName ?? null,
    tenantId: origin.tenantId ?? params.tenantId ?? null,
    appId: origin.appId ?? params.appId ?? null
  };
}

function resolveFolders(params, origin, upload) {
  const folders = isPlainObject(params?.folders) ? params.folders : {};
  const rootFolder = folders.rootFolder ?? params.rootFolder ?? null;
  const tenantRootFolder = folders.tenantRootFolder ?? params.tenantRootFolder ?? null;
  return {
    tenantRootFolder,
    rootFolder,
    actionsRootFolder: folders.actionsRootFolder ?? params.actionsRootFolder ?? (rootFolder ? `${rootFolder}/actions` : null),
    assetsRootFolder: folders.assetsRootFolder ?? params.assetsRootFolder ?? (rootFolder ? `${rootFolder}/assets` : null),
    httpMiddlewaresRootFolder: folders.httpMiddlewaresRootFolder ?? params.httpMiddlewaresRootFolder ?? null,
    wsMiddlewaresRootFolder: folders.wsMiddlewaresRootFolder ?? params.wsMiddlewaresRootFolder ?? null,
    routesRootFolder: folders.routesRootFolder ?? params.routesRootFolder ?? (rootFolder ? `${rootFolder}/routes` : null)
  };
}

function freezeRun(run) {
  return run ? Object.freeze({ ...run }) : null;
}

function freezeTarget(target) {
  const normalizedTarget = isPlainObject(target) ? target : {};
  return Object.freeze({
    type: normalizedTarget.type ?? null,
    value: normalizedTarget.value ?? null,
    asset: normalizedTarget.asset?.path
      ? Object.freeze({ path: normalizedTarget.asset.path })
      : null,
    run: freezeRun(normalizedTarget.run),
    redirect: normalizedTarget.redirect?.location
      ? Object.freeze({
        location: normalizedTarget.redirect.location,
        status: Number.isFinite(normalizedTarget.redirect.status)
          ? normalizedTarget.redirect.status
          : DEFAULT_REDIRECT_STATUS
      })
      : null
  });
}

function freezeUpload(upload) {
  return Object.freeze({
    uploadPath: upload?.uploadPath ?? null,
    uploadTypes: Array.isArray(upload?.uploadTypes) ? Object.freeze([...upload.uploadTypes]) : (upload?.uploadTypes ?? null),
    diskLimit: upload?.diskLimit ?? null,
    diskLimitBytes: upload?.diskLimitBytes ?? null
  });
}

function freezeOrigin(origin) {
  return Object.freeze({
    hostname: origin?.hostname ?? null,
    appURL: origin?.appURL ?? null,
    domain: origin?.domain ?? null,
    appName: origin?.appName ?? null,
    tenantId: origin?.tenantId ?? null,
    appId: origin?.appId ?? null
  });
}

function normalizeMiddlewareLabels(middleware) {
  const labels = Array.isArray(middleware)
    ? middleware
    : (middleware == null ? [] : [middleware]);

  return labels
    .map((label) => String(label ?? ``).trim())
    .filter(Boolean);
}

function freezeFolders(folders) {
  return Object.freeze({
    tenantRootFolder: folders?.tenantRootFolder ?? null,
    rootFolder: folders?.rootFolder ?? null,
    actionsRootFolder: folders?.actionsRootFolder ?? null,
    assetsRootFolder: folders?.assetsRootFolder ?? null,
    httpMiddlewaresRootFolder: folders?.httpMiddlewaresRootFolder ?? null,
    wsMiddlewaresRootFolder: folders?.wsMiddlewaresRootFolder ?? null,
    routesRootFolder: folders?.routesRootFolder ?? null
  });
}

function normalizeResourceIdentifier(resource) {
  const normalized = String(resource ?? ``).trim().replaceAll(`\\`, `/`);
  if (!normalized) return null;
  return normalized
    .replace(/^actions\//, ``)
    .replace(/\.js$/i, ``)
    .replace(/^\/+/, ``)
    .replace(/\/+/g, `/`)
    .trim() || null;
}

function normalizeActionIdentifier(action) {
  const normalized = String(action ?? ``).trim();
  return normalized || null;
}

function normalizeContentType(contentType) {
  return String(contentType ?? ``)
    .split(`;`)[0]
    .trim()
    .toLowerCase();
}

module.exports = TenantRouteMeta;
Object.freeze(module.exports);
