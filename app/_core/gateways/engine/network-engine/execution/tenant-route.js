// _core/gateways/engine/network-engine/execution/tenant-route.js


'use strict';


const DEFAULT_METHODS = Object.freeze([`GET`]);

/** Immutable route descriptor that represents the resolved tenant controller target. */
class TenantRoute {
  /** @type {[string]} */
  upload;

  /** Stores resolved tenant route metadata and freezes it for request-safe reuse. */
  constructor({
    asset,
    i18n,
    controller,
    call,

    cache,
    session,
    redirect,
    status,

    methods = DEFAULT_METHODS,
    methodsAvailable = DEFAULT_METHODS,
    'content-types': configuredContentTypes = null,
    contentTypes = configuredContentTypes,
    uploadPath,
    uploadTypes,
    maxInputBytes,

    host,
    domain,
    subdomain,
    rootFolder,
    diskLimit,
    diskLimitBytes,
    appRootFolder = `${rootFolder}/src/app`,
    publicRootFolder = `${rootFolder}/src/public`,
  }) {
    this.asset = asset;
    this.i18n = i18n;
    this.controller = controller;
    this.call = call;

    this.cache = cache;
    this.session = session;
    this.redirect = redirect;

    this.status = status;

    this.methodsAvailable = Object.freeze(normalizeMethods(methodsAvailable));
    this.methods = Object.freeze(normalizeMethods(methods));
    this.contentTypes = normalizeContentTypes(contentTypes);
    this.uploadPath = uploadPath;
    this.uploadTypes = uploadTypes;
    this.maxInputBytes = maxInputBytes;

    this.host = host;
    this.domain = domain;
    this.subdomain = subdomain;
    this.rootFolder = rootFolder;
    this.diskLimit = diskLimit;
    this.diskLimitBytes = diskLimitBytes;
    this.appRootFolder = appRootFolder;
    this.publicRootFolder = publicRootFolder;

    Object.freeze(this);
  }

  /** Reports whether the route points to a static asset response. */
  isStaticAsset() { return !this.i18n && this.asset; }
  /** Builds the absolute file path for the resolved static asset. */
  assetPath() { return `${this.publicRootFolder}/${this.asset}`; }
  /** Reports whether the route should emit a redirect response. */
  isRedirect() { return this.redirect; }
  /** Reports whether the provided HTTP method is allowed for the host. */
  allowsHostMethod(method) {
    return this.methodsAvailable.includes(String(method ?? ``).trim().toUpperCase());
  }
  /** Reports whether the provided HTTP method is allowed for this route. */
  allowsMethod(method) {
    return this.methods.includes(String(method ?? ``).trim().toUpperCase());
  }
  /** Reports whether the provided request Content-Type is allowed for this route. */
  allowsContentType(contentType) {
    if (this.contentTypes == null) return true;
    return this.contentTypes.includes(normalizeContentType(contentType));
  }
  /** Resolves an arbitrary tenant-local file path from the tenant root folder. */
  getFilePath(file) { return `${this.rootFolder}/${file}`; }

  /** Builds the cache file path for a URL when route caching is enabled. */
  getCacheFilePath(url) {
    if (this.cache === `no-cache`) { return null; }
    const root = this.rootFolder;
    const cacheFolder = `cache`;
    const filename = url.replace(/\//g, `]_[`);
    return `${root}/${cacheFolder}/[${filename}]`;
  }
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

function normalizeContentType(contentType) {
  return String(contentType ?? ``)
    .split(`;`)[0]
    .trim()
    .toLowerCase();
}

module.exports = TenantRoute;
Object.freeze(module.exports);
