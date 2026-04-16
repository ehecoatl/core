// _core/runtimes/ingress-runtime/execution/tenant-route.js


'use strict';


const TenantRouteMeta = require(`@/_core/runtimes/ingress-runtime/execution/tenant-route-meta`);

/** Immutable route descriptor that represents the resolved tenant action target. */
class TenantRoute {

  /** Stores resolved tenant route metadata and freezes it for request-safe reuse. */
  constructor(params) {
    this.meta = new TenantRouteMeta(params);
    this.pointsTo = this.meta.pointsTo;
    this.target = this.meta.target;
    this.i18n = this.meta.i18n;
    this.cache = this.meta.cache;
    this.session = this.meta.session;
    this.middleware = this.meta.middleware;
    this.methodsAvailable = this.meta.methodsAvailable;
    this.methods = this.meta.methods;
    this.contentTypes = this.meta.contentTypes;
    this.upload = this.meta.upload;
    this.maxInputBytes = this.meta.maxInputBytes;
    this.origin = this.meta.origin;
    this.folders = this.meta.folders;

    Object.freeze(this);
  }

  /** Reports whether the route points to a static asset response. */
  isStaticAsset() { return !this.i18n && this.target.asset?.path; }
  /** Builds the absolute file path for the resolved static asset. */
  assetPath() { return `${this.folders.assetsRootFolder}/${this.target.asset.path}`; }
  /** Reports whether the route should emit a redirect response. */
  isRedirect() { return this.target.redirect; }
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
  getFilePath(file) { return `${this.folders.rootFolder}/${file}`; }

  /** Builds the cache file path for a URL when route caching is enabled. */
  getCacheFilePath(url) {
    if (this.cache === `no-cache`) { return null; }
    const root = this.folders.rootFolder;
    const cacheFolder = `.ehecoatl/.cache`;
    const filename = url.replace(/\//g, `]_[`);
    return `${root}/${cacheFolder}/[${filename}]`;
  }
}

module.exports = TenantRoute;
Object.freeze(module.exports);
