// _core/gateways/engine/network-engine/network2manager-resolver.js


'use strict';


const NetworkEngine = require(`g@/engine/network-engine/network-engine`);
const TenantRoute = require(`g@/engine/network-engine/execution/tenant-route`);
const { runAsyncCacheTask } = require(`@/utils/cache/cache-async`);

/** Engine-side RPC resolver that bridges request execution with manager process services. */
class Network2ManagerResolver {

  question;
  cache;
  rpc;
  plugin;
  routeCacheTTL;
  routeMissTTL;
  scanActiveCacheKey;
  asyncCacheTimeoutMs;

  /**
   * Captures engine-side service references used to talk to the manager process.
   * @param {NetworkEngine} networkEngine
   */
  constructor(networkEngine) {
    const tenancyRouterConfig = networkEngine.tenancyRouterConfig
      ?? networkEngine.config?.tenancyRouter
      ?? {};
    this.question = networkEngine.config.question;
    this.cache = networkEngine.services.cache;
    this.rpc = networkEngine.services.rpc;
    this.plugin = networkEngine.plugin;
    this.routeCacheTTL = networkEngine.routeCacheTTL ?? null;
    this.routeMissTTL = tenancyRouterConfig.routeMissTTL
      ?? networkEngine.config?.routeMissTTL
      ?? 5000;
    this.scanActiveCacheKey = tenancyRouterConfig.scanActiveCacheKey ?? null;
    this.asyncCacheTimeoutMs = tenancyRouterConfig.asyncCacheTimeoutMs ?? 500;

    Object.freeze(this);
  }

  /** Sends a generic RPC question to the manager process. */
  async ask(question, data, executionContext = null) {
    return await this.rpc.ask({
      question,
      data,
      internalMeta: buildRequestInternalMeta(executionContext),
      target: `manager`
    });
  }

  /**
   * This method resolves url tenancy for further
   * treatment and handle
   */
  /** Resolves and caches the tenant route for the current execution context URL. */
  async resolveRoute(executionContext) {
    let tenantRoute = null;
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { BEFORE, AFTER, ERROR } = hooks.ENGINE.REQUEST.GET_ROUTER;
    await plugin.run(BEFORE, executionContext, ERROR);

    const { url } = executionContext.requestData;
    const missCacheKey = `urlRouteMiss:${url}`;
    const routeCacheKey = `urlRouteData:${url}`;
    const scanActive = await this.#isScanActive();

    if (!scanActive) {
      const cachedMiss = await this.cache.get(missCacheKey, null);
      if (cachedMiss) {
        await plugin.run(AFTER, executionContext, ERROR);
        return null;
      }

      const cachedData = await this.cache.get(routeCacheKey, null);
      if (cachedData) {
        tenantRoute = JSON.parse(cachedData);
      }
    }

    if (!tenantRoute) {
      // IF NOT FOUND, ask manager to resolve route.
      tenantRoute = await this.rpc.ask({
        question: this.question.tenancyRouter,
        target: `manager`,
        data: { url },
        internalMeta: buildRequestInternalMeta(executionContext)
      });
      if (tenantRoute?.success === false && tenantRoute?.error) {
        const routeResolutionError = new Error(tenantRoute.error);
        routeResolutionError.code = tenantRoute.code ?? `ROUTE_RESOLUTION_FAILED`;
        throw routeResolutionError;
      }
      if (!scanActive) {
        if (tenantRoute) {
          this.#cacheRouteData(routeCacheKey, tenantRoute);
        } else {
          this.#cacheRouteMiss(missCacheKey);
        }
      }
    }
    console.log(
      `[network2manager-resolver.resolveRoute] url=${url ?? `null`} resolved=${tenantRoute ? `yes` : `no`} host=${tenantRoute?.host ?? `null`}`
    );
    if (tenantRoute) {
      tenantRoute = new TenantRoute(tenantRoute);
    }
    await plugin.run(AFTER, executionContext, ERROR);
    return tenantRoute;
  }

  /** Reads a shared object from cache storage by key. */
  async getObject(key, defaultValue = {}) {
    const answer = await this.rpc.ask({
      question: this.question.getSharedObject,
      target: `manager`,
      data: { key }
    });
    return answer ?? defaultValue;
  }

  /** Persists a shared object into cache storage by key and TTL. */
  async setObject(key, value, ttl) {
    const answer = await this.rpc.ask({
      question: this.question.setSharedObject,
      target: `manager`,
      data: { key, value, ttl }
    });
    return answer;
  }

  /** Checks the shared scan-active marker to decide if route-cache reads should be bypassed. */
  async #isScanActive() {
    if (!this.scanActiveCacheKey) return false;

    const marker = await this.cache.get(this.scanActiveCacheKey, null).catch(() => null);
    return Boolean(marker);
  }

  /** Persists one positive route-match cache entry asynchronously. */
  #cacheRouteData(cacheKey, tenantRoute) {
    runAsyncCacheTask({
      channel: `route_cache`,
      operation: `set_route_data`,
      timeoutMs: this.asyncCacheTimeoutMs,
      details: { cacheKey },
      execute: async () => {
        await this.cache.set(
          cacheKey,
          JSON.stringify(tenantRoute),
          this.routeCacheTTL ?? undefined
        );
      }
    });
  }

  /** Persists one negative route-match cache entry asynchronously. */
  #cacheRouteMiss(cacheKey) {
    runAsyncCacheTask({
      channel: `route_cache`,
      operation: `set_route_miss`,
      timeoutMs: this.asyncCacheTimeoutMs,
      details: { cacheKey },
      execute: async () => {
        await this.cache.set(cacheKey, `1`, this.routeMissTTL);
      }
    });
  }
}

function buildRequestInternalMeta(executionContext) {
  const requestId = executionContext?.meta?.requestId
    ?? executionContext?.requestData?.requestId
    ?? null;
  const correlationId = executionContext?.meta?.correlationId
    ?? requestId;
  if (!requestId && !correlationId) return undefined;
  return {
    requestId,
    correlationId
  };
}

module.exports = Network2ManagerResolver;
Object.freeze(module.exports);
