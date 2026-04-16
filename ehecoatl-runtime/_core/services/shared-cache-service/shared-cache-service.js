// _core/services/shared-cache-service/shared-cache-service.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Shared cache service use case that wraps cache adapter calls with plugin hook instrumentation. */
class SharedCacheService extends AdaptableUseCase {
  #connectPromise = null;
  /** @type {typeof import('@/config/default.config').adapters.sharedCacheService} */
  config;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;
  sharedCacheHooks;
  failurePolicy;
  /** @type {import('@/_core/_ports/outbound/shared-cache-service-port')} */
  adapter = null;

  /** Captures cache config, hook references, and lazy adapter metadata for shared cache access. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.sharedCacheService);
    this.config = kernelContext.config.adapters.sharedCacheService;
    this.plugin = kernelContext.pluginOrchestrator;
    this.sharedCacheHooks = this.plugin.hooks.SHARED.SHARED_CACHE;
    this.failurePolicy = buildFailurePolicy(this.config.failurePolicy);
    super.loadAdapter();

    Object.freeze(this);
  }

  /** Reads one cached value, returning a default when the key is missing. */
  async get(key, defaultValue = null) {
    return this.#wrapAdapterCall(
      `getAdapter`,
      { operation: `get`, key, defaultValue },
      { key, defaultValue }
    );
  }

  /** Stores one cached value with an optional TTL. */
  async set(key, value, ttl) {
    return this.#wrapAdapterCall(
      `setAdapter`,
      { operation: `set`, key, value, ttl },
      { key, value, ttl }
    );
  }

  /** Deletes one cached value by exact key. */
  async delete(key) {
    return this.#wrapAdapterCall(
      `deleteAdapter`,
      { operation: `delete`, key },
      { key }
    );
  }

  /** Deletes cached values by prefix. */
  async deleteByPrefix(prefix) {
    return this.#wrapAdapterCall(
      `deleteByPrefixAdapter`,
      { operation: `deleteByPrefix`, prefix },
      { prefix }
    );
  }

  /** Checks whether a cache key exists in the active backend. */
  async has(key) {
    return this.#wrapAdapterCall(
      `hasAdapter`,
      { operation: `has`, key },
      { key }
    );
  }

  /** Appends one value into a list-like cache entry. */
  async appendList(key, value) {
    return this.#wrapAdapterCall(
      `appendListAdapter`,
      { operation: `appendList`, key, value },
      { key, value }
    );
  }

  /** Retrieves a list slice from the current cache backend. */
  async getList(key, start, finish) {
    return this.#wrapAdapterCall(
      `getListAdapter`,
      { operation: `getList`, key, start, finish },
      { key, start, finish }
    );
  }

  /** Wraps one cache adapter call with before/after/error plugin hook dispatch. */
  async #wrapAdapterCall(methodName, payload, params) {
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = this.sharedCacheHooks;
    super.loadAdapter();
    const adapterMethod = this.adapter?.[methodName] ?? null;
    if (typeof adapterMethod !== `function`) {
      throw new Error(`Shared cache adapter method "${methodName}" is not available`);
    }

    await plugin.run(BEFORE, payload, ERROR).catch(() => { });
    try {
      await this.#ensureAdapterConnected();
      const result = await adapterMethod(params);
      await plugin.run(AFTER, { ...payload, result }, ERROR).catch(() => { });
      return result;
    } catch (error) {
      await plugin.run(ERROR, { ...payload, error }).catch(() => { });
      const fallback = this.#resolveOperationFallback(payload?.operation, params, error);
      if (fallback.handled) return fallback.value;
      throw error;
    }
  }

  /** Establishes the cache adapter connection once before read/write operations. */
  async #ensureAdapterConnected() {
    const connectAdapter = this.adapter?.connectAdapter ?? null;
    if (typeof connectAdapter !== `function`) return;

    if (!this.#connectPromise) {
      this.#connectPromise = Promise.resolve()
        .then(() => connectAdapter())
        .catch((error) => {
          this.#connectPromise = null;
          throw error;
        });
    }

    await this.#connectPromise;
  }

  #resolveOperationFallback(operation, params, error) {
    const policy = this.failurePolicy?.[operation] ?? null;
    if (!policy || policy.failOpen !== true) {
      return { handled: false, value: undefined };
    }

    if (policy.warn === true) {
      const pointer = resolveFailurePointer(operation, params);
      const reason = error?.message ?? String(error);
      console.warn(
        `[shared_cache_warning] operation=${operation} target=${pointer} failOpen=true reason=${reason}`
      );
    }

    if (operation === `get`) {
      return {
        handled: true,
        value: Object.prototype.hasOwnProperty.call(params ?? {}, `defaultValue`)
          ? params.defaultValue
          : null
      };
    }

    if (operation === `deleteByPrefix`) {
      return { handled: true, value: 0 };
    }

    if (operation === `getList`) {
      return { handled: true, value: [] };
    }

    return { handled: true, value: false };
  }
}

function buildFailurePolicy(config = {}) {
  return {
    get: normalizeFailureRule(config.get, { failOpen: true, warn: true }),
    set: normalizeFailureRule(config.set, { failOpen: true, warn: true }),
    delete: normalizeFailureRule(config.delete, { failOpen: true, warn: true }),
    deleteByPrefix: normalizeFailureRule(config.deleteByPrefix, { failOpen: true, warn: true }),
    has: normalizeFailureRule(config.has, { failOpen: true, warn: true }),
    appendList: normalizeFailureRule(config.appendList, { failOpen: true, warn: true }),
    getList: normalizeFailureRule(config.getList, { failOpen: true, warn: true })
  };
}

function normalizeFailureRule(rule, defaults) {
  const nextRule = (rule && typeof rule === `object`) ? rule : {};
  return {
    failOpen: nextRule.failOpen !== false && defaults.failOpen === true,
    warn: nextRule.warn !== false && defaults.warn === true
  };
}

function resolveFailurePointer(operation, params = {}) {
  if (operation === `deleteByPrefix`) return String(params.prefix ?? `unknown`);
  if (operation === `getList`) return String(params.key ?? `unknown`);
  if (operation === `appendList`) return String(params.key ?? `unknown`);
  if (operation === `has`) return String(params.key ?? `unknown`);
  if (operation === `delete`) return String(params.key ?? `unknown`);
  if (operation === `set`) return String(params.key ?? `unknown`);
  if (operation === `get`) return String(params.key ?? `unknown`);
  return `unknown`;
}

module.exports = SharedCacheService;
Object.freeze(module.exports);
