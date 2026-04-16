// _core/gateways/manager/tenancy-router/tenancy-router.js


'use strict';

const GatewayCore = require(`g@/gateway-core`);
const path = require(`path`);
const startup = require(`@/utils/logger/logger-startup`);

/** Manager gateway that scans tenants and resolves cached route matches to tenant metadata. */
class TenancyRouter extends GatewayCore {
  /** @type {import('g@/index').StorageService} */
  storageService;
  /** @type {import('g@/index').SharedCacheService} */
  sharedCacheService;

  /** @type {import('./tenancy-router-adapter')} */
  adapter = null;

  /** @type {typeof import('@/config/default.config').tenancyRouter} */
  config;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;

  localCache; //TODO: move to adapter?
  runtime;
  invalidationPrefixes;
  processReloadQuestion;
  processShutdownQuestion;

  /** Captures tenancy config, shared services, and lazy adapter metadata for tenant resolution. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.tenancyRouter);
    this.config = kernelContext.config.tenancyRouter;
    this.plugin = kernelContext.plugin;
    this.storageService = kernelContext.gateways.storageService;
    this.sharedCacheService = kernelContext.gateways.sharedCacheService;
    this.localCache = new Map();
    this.runtime = {
      scanInterval: null,
      responseCacheCleanupInterval: null,
      firstScanPromise: null,
      ready: false,
      lastScanAt: null,
      lastScanError: null,
      responseCacheCleanupPromise: null
    };
    this.invalidationPrefixes = Object.freeze([
      `urlRouteData:`,
      `urlRouteMiss:`,
      `validResponseCache:`
    ]);
    this.rpcEndpoint = kernelContext.gateways?.rpcEndpoint ?? null;
    this.processReloadQuestion = kernelContext.config.processSupervisor?.question?.reloadProcess ?? `reloadProcess`;
    this.processShutdownQuestion = kernelContext.config.processSupervisor?.question?.shutdownProcess ?? `shutdownProcess`;
    this.processEnsureQuestion = kernelContext.config.processSupervisor?.question?.ensureProcess ?? `ensureProcess`;
    this.processListQuestion = kernelContext.config.processSupervisor?.question?.listProcesses ?? `listProcesses`;
    this.spawnTenantAppAfterScan = this.config.spawnTenantAppAfterScan === true;
    this.TTL = this.config.routeMatchTTL ?? 60 * 1000; // 60seconds - 1minute
    this.scanTTL = this.config.scanIntervalMs ?? 5 * 60 * 1000; // 5*60seconds - 5minutes
    this.scanActiveCacheKey = this.config.scanActiveCacheKey ?? null;
    this.scanActiveTTL = this.config.scanActiveTTL ?? 30_000;
    this.responseCacheCleanupTTL = this.config.responseCacheCleanupIntervalMs ?? this.scanTTL;
    super.loadAdapter();

    Object.freeze(this);
  }

  /** Resolves a tenant route match for a URL and caches it for a short TTL. */
  async matchRoute({ url }) {
    super.loadAdapter();
    await this.waitUntilReady();
    const cached = this.localCache.get(url);
    if (cached && Date.now() < cached.validUntil)
      return cached.tenantRoute;

    const routeMatchData = await this.adapter.matchRouteAdapter({ url });
    console.log(
      `[tenancy-router.matchRoute] url=${url ?? `null`} resolved=${routeMatchData ? `yes` : `no`} host=${routeMatchData?.host ?? `null`}`
    );
    const cachedData = {
      tenantRoute: routeMatchData,
      validUntil: Date.now() + this.TTL
    };
    this.localCache.set(url, cachedData);
    return routeMatchData;
  }

  /** Exposes current scan-readiness state for startup coordination and diagnostics. */
  getReadinessSnapshot() {
    return {
      ready: this.runtime.ready,
      lastScanAt: this.runtime.lastScanAt,
      lastScanError: this.runtime.lastScanError
    };
  }

  /** Waits for the first completed tenant scan before traffic can resolve routes. */
  async waitUntilReady() {
    if (!this.runtime.firstScanPromise) {
      throw new Error(`TenancyRouter first scan has not been started`);
    }

    await this.runtime.firstScanPromise;
    if (!this.runtime.ready) {
      throw new Error(`TenancyRouter is not ready for route resolution`);
    }
  }

  /** Executes one scan cycle and records visible readiness/error state. */
  async runScanCycle() {
    const cycleStartedAt = Date.now();
    await this.#markScanActive();
    try {
      const scanStartedAt = Date.now();
      const scanSummary = await this.adapter.scanTenantsAdapter({
        config: this.config,
        storage: this.storageService
      });
      startup.startupInfoLog(`Tenancy scan adapter completed in ${Date.now() - scanStartedAt}ms`);
      this.localCache.clear();
      const invalidationStartedAt = Date.now();
      await this.#invalidateSharedCaches();
      startup.startupInfoLog(`Tenancy shared-cache invalidation completed in ${Date.now() - invalidationStartedAt}ms`);
      const syncStartedAt = Date.now();
      await this.#syncTenantProcesses(scanSummary);
      startup.startupInfoLog(`Tenancy process reconciliation completed in ${Date.now() - syncStartedAt}ms`);
      this.runtime.ready = true;
      this.runtime.lastScanAt = Date.now();
      this.runtime.lastScanError = null;
      startup.startupInfoLog(`Tenancy scan cycle completed in ${Date.now() - cycleStartedAt}ms`);
    } catch (error) {
      this.runtime.ready = false;
      this.runtime.lastScanError = error;
      throw error;
    } finally {
      const clearMarkerStartedAt = Date.now();
      await this.#clearScanMarker();
      startup.startupInfoLog(`Tenancy scan marker clear completed in ${Date.now() - clearMarkerStartedAt}ms`);
    }
  }

  /** Starts the initial tenant scan and schedules periodic refresh cycles. */
  async scan() {
    super.loadAdapter();
    if (!this.runtime.firstScanPromise) {
      this.runtime.firstScanPromise = this.runScanCycle();
    }

    if (!this.runtime.scanInterval) {
      this.runtime.scanInterval = setInterval(() => {
        this.runScanCycle().catch(() => { });
      }, this.scanTTL);
      this.runtime.scanInterval?.unref();
    }

    if (!this.runtime.responseCacheCleanupInterval && this.responseCacheCleanupTTL > 0) {
      this.runtime.responseCacheCleanupInterval = setInterval(() => {
        this.cleanupInvalidResponseCacheArtifacts().catch(() => { });
      }, this.responseCacheCleanupTTL);
      this.runtime.responseCacheCleanupInterval?.unref();
      Promise.resolve()
        .then(() => this.cleanupInvalidResponseCacheArtifacts())
        .catch(() => { });
    }

    await this.runtime.firstScanPromise;
  }

  /** Scans tenant cache folders asynchronously and removes orphaned response-cache artifacts. */
  async cleanupInvalidResponseCacheArtifacts() {
    if (this.runtime.responseCacheCleanupPromise) {
      return this.runtime.responseCacheCleanupPromise;
    }

    this.runtime.responseCacheCleanupPromise = (async () => {
      let removed = 0;
      for (const rootFolder of await this.#listTenantRootFolders()) {
        removed += await this.#cleanupTenantResponseCacheArtifacts(rootFolder);
      }
      return removed;
    })();

    try {
      return await this.runtime.responseCacheCleanupPromise;
    } finally {
      this.runtime.responseCacheCleanupPromise = null;
    }
  }

  /** Stops periodic scans, clears route cache, and delegates adapter teardown. */
  async destroy() {
    if (this.runtime.scanInterval) {
      clearInterval(this.runtime.scanInterval);
      this.runtime.scanInterval = null;
    }
    if (this.runtime.responseCacheCleanupInterval) {
      clearInterval(this.runtime.responseCacheCleanupInterval);
      this.runtime.responseCacheCleanupInterval = null;
    }
    this.runtime.firstScanPromise = null;
    this.runtime.ready = false;
    this.runtime.lastScanAt = null;
    this.runtime.lastScanError = null;
    this.runtime.responseCacheCleanupPromise = null;
    this.localCache.clear();
    await super.destroy();
  }

  /** Clears shared route and response caches after successful tenancy scans. */
  async #invalidateSharedCaches() {
    await Promise.all(
      this.invalidationPrefixes.map((prefix) => this.sharedCacheService.deleteByPrefix(prefix))
    );
  }

  /** Requests selective tenant-process reloads or shutdowns after successful tenant scans. */
  async #syncTenantProcesses(scanSummary) {
    if (!this.rpcEndpoint) return;

    if (this.spawnTenantAppAfterScan) {
      await this.#reconcileTenantAppProcesses(scanSummary);
    }

    if (scanSummary?.initialScan) return;

    const changedHosts = Array.isArray(scanSummary.changedHosts) ? scanSummary.changedHosts : [];
    const removedHosts = Array.isArray(scanSummary.removedHosts) ? scanSummary.removedHosts : [];

    for (const host of changedHosts) {
      await this.rpcEndpoint.ask({
        target: `main`,
        question: this.processReloadQuestion,
        data: {
          label: `tenant_${host}`,
          reason: `tenancy_scan_changed`
        }
      }).catch(() => { });
    }

    for (const host of removedHosts) {
      await this.rpcEndpoint.ask({
        target: `main`,
        question: this.processShutdownQuestion,
        data: {
          label: `tenant_${host}`,
          reason: `tenancy_scan_removed`
        }
      }).catch(() => { });
    }
  }

  /** Ensures active tenants are running and shuts down stale tenant_* processes missing from the scan result. */
  async #reconcileTenantAppProcesses(scanSummary = {}) {
    const activeHosts = Array.isArray(scanSummary.activeHosts) ? scanSummary.activeHosts : [];
    const activeHostsSet = new Set(
      activeHosts
        .map((entry) => entry?.host)
        .filter((host) => typeof host === `string` && host.length > 0)
    );

    for (const activeHost of activeHosts) {
      const host = activeHost?.host;
      if (!host) continue;
      const rootFolder = activeHost?.rootFolder ?? null;
      await this.rpcEndpoint.ask({
        target: `main`,
        question: this.processEnsureQuestion,
        data: {
          label: `tenant_${host}`,
          reason: `tenancy_scan_ensure`,
          processType: `tenantApp`,
          tenantHost: host,
          tenantRoot: rootFolder
        }
      }).catch(() => { });
    }

    const processListing = await this.rpcEndpoint.ask({
      target: `main`,
      question: this.processListQuestion,
      data: {}
    }).catch(() => null);

    const runningProcesses = Array.isArray(processListing?.processes)
      ? processListing.processes
      : [];

    for (const processInfo of runningProcesses) {
      const label = processInfo?.label;
      if (!label || !label.startsWith(`tenant_`)) continue;
      const host = label.slice(`tenant_`.length);
      if (activeHostsSet.has(host)) continue;

      await this.rpcEndpoint.ask({
        target: `main`,
        question: this.processShutdownQuestion,
        data: {
          label,
          reason: `tenancy_scan_inactive_host`
        }
      }).catch(() => { });
    }
  }

  /** Lists active tenant root folders directly from the configured tenants path. */
  async #listTenantRootFolders() {
    const domainsList = await this.storageService.listEntries(this.config.tenantsPath) ?? [];
    const rootFolders = [];

    for (const domainEntry of domainsList) {
      if (!domainEntry?.isDirectory?.()) continue;
      const domainPath = path.join(this.config.tenantsPath, domainEntry.name);
      const subdomainsList = await this.storageService.listEntries(domainPath) ?? [];
      for (const subdomainEntry of subdomainsList) {
        if (!subdomainEntry?.isDirectory?.()) continue;
        rootFolders.push(path.join(domainPath, subdomainEntry.name));
      }
    }

    return rootFolders;
  }

  /** Removes orphaned response-cache artifacts for one tenant root cache folder. */
  async #cleanupTenantResponseCacheArtifacts(rootFolder) {
    const cacheFolder = path.join(rootFolder, `cache`);
    if (!await this.#pathExists(cacheFolder)) {
      return 0;
    }

    const entries = await this.storageService.listEntries(cacheFolder) ?? [];
    let removed = 0;

    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      const decodedUrl = decodeResponseCacheUrlFromFileName(entry.name);
      if (!decodedUrl) continue;

      const artifactPath = path.join(cacheFolder, entry.name);
      const cacheKey = `validResponseCache:${decodedUrl}`;
      const activeArtifactPath = await this.sharedCacheService.get(cacheKey, null);
      if (activeArtifactPath === artifactPath) continue;

      const deleted = await this.storageService.deleteFile(artifactPath);
      if (deleted) {
        removed += 1;
      }
    }

    return removed;
  }

  /** Checks storage-path existence without treating missing paths as cleanup failures. */
  async #pathExists(targetPath) {
    try {
      return await this.storageService.fileExists(targetPath);
    } catch {
      return false;
    }
  }

  /** Marks tenancy scans as active in shared cache so route-cache reads can be bypassed safely. */
  async #markScanActive() {
    if (!this.scanActiveCacheKey) return;
    if (typeof this.sharedCacheService?.set !== `function`) return;

    await this.sharedCacheService.set(
      this.scanActiveCacheKey,
      `1`,
      this.scanActiveTTL
    ).catch(() => { });
  }

  /** Clears the scan-active marker once the tenancy scan cycle settles. */
  async #clearScanMarker() {
    if (!this.scanActiveCacheKey) return;
    if (typeof this.sharedCacheService?.delete !== `function`) return;

    await this.sharedCacheService.delete(this.scanActiveCacheKey)
      .catch(() => { });
  }

}

function decodeResponseCacheUrlFromFileName(fileName) {
  const parsed = path.parse(String(fileName ?? ``));
  const baseName = parsed.name;
  if (!baseName.startsWith(`[`) || !baseName.endsWith(`]`)) return null;

  return baseName.slice(1, -1).replaceAll(`]_[`, `/`);
}

module.exports = TenancyRouter;
Object.freeze(module.exports);
