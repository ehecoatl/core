// _core/resolvers/middleware-stack-resolver/middleware-stack-resolver.js


'use strict';


const fs = require(`node:fs/promises`);
const path = require(`node:path`);

const { renderLayerPath } = require(`@/contracts/utils`);
const { findOpaqueAppRecordByTenantIdAndAppIdSync } = require(`@/utils/tenancy/tenant-layout`);

class MiddlewareStackResolver {
  config;
  tenantId;
  tenantsBase;
  coreMiddlewaresPath;
  tenantMiddlewarePaths;
  appMiddlewarePathsResolver;
  coreMiddlewares;
  coreMiddlewareOrder;
  tenantMiddlewares;
  appMiddlewares;

  constructor({
    config,
    tenantId = null,
    tenantsBase = null,
    coreMiddlewaresPath = null,
    tenantMiddlewarePaths = null,
    appMiddlewarePathsResolver = null
  } = {}) {
    this.config = config ?? {};
    this.tenantId = typeof tenantId === `string` && tenantId.trim()
      ? tenantId.trim().toLowerCase()
      : null;
    this.tenantsBase = tenantsBase
      ?? this.config?.adapters?.tenantDirectoryResolver?.tenantsPath
      ?? null;
    this.coreMiddlewaresPath = coreMiddlewaresPath ?? null;
    this.tenantMiddlewarePaths = tenantMiddlewarePaths ?? null;
    this.appMiddlewarePathsResolver = appMiddlewarePathsResolver ?? null;
    this.coreMiddlewares = Object.freeze({});
    this.coreMiddlewareOrder = Object.freeze([]);
    this.tenantMiddlewares = freezeProtocolRegistry({
      http: {},
      ws: {}
    });
    this.appMiddlewares = Object.create(null);
  }

  async initialize() {
    const coreMiddlewaresPath = await this.#resolveCoreMiddlewaresPath();
    this.coreMiddlewareOrder = await loadCoreMiddlewareOrder(coreMiddlewaresPath);
    this.coreMiddlewares = freezeRegistry(
      await loadMiddlewareRegistry(coreMiddlewaresPath, {
        include(middlewareName) {
          return middlewareName.startsWith(`core-`);
        }
      })
    );
    validateCoreMiddlewareManifest(this.coreMiddlewareOrder, this.coreMiddlewares);
    this.tenantMiddlewares = await this.#loadTenantMiddlewares();
    return this;
  }

  getCoreMiddlewares() {
    return this.coreMiddlewares;
  }

  getCoreMiddlewareOrder() {
    return this.coreMiddlewareOrder;
  }

  getTenantMiddlewares() {
    return this.tenantMiddlewares;
  }

  getAppMiddlewares(appId) {
    const normalizedAppId = normalizeKey(appId);
    return normalizedAppId ? this.appMiddlewares[normalizedAppId] ?? null : null;
  }

  async loadAppMiddlewares(appId) {
    const normalizedAppId = normalizeKey(appId);
    if (!normalizedAppId) {
      throw new Error(`middleware-stack-resolver requires a valid appId`);
    }

    const cached = this.getAppMiddlewares(normalizedAppId);
    if (cached) return cached;

    if (!this.tenantId) {
      throw new Error(`middleware-stack-resolver requires tenantId to load app middlewares`);
    }

    const appRecord = findOpaqueAppRecordByTenantIdAndAppIdSync({
      tenantsBase: this.tenantsBase,
      tenantId: this.tenantId,
      appId: normalizedAppId
    });
    if (!appRecord) {
      throw new Error(
        `App "${normalizedAppId}" is not present inside transport tenant "${this.tenantId}"`
      );
    }

    const registry = await loadProtocolRegistry(
      this.#resolveAppMiddlewarePaths(normalizedAppId, appRecord)
    );
    this.appMiddlewares[normalizedAppId] = registry;
    return registry;
  }

  async #loadTenantMiddlewares() {
    if (!this.tenantId) {
      throw new Error(`middleware-stack-resolver requires tenantId to initialize tenant middlewares`);
    }

    return loadProtocolRegistry(this.#resolveTenantMiddlewarePaths());
  }

  async #resolveCoreMiddlewaresPath() {
    if (this.coreMiddlewaresPath) return this.coreMiddlewaresPath;
    return path.dirname(require.resolve(`@middleware/core.js`));
  }

  #resolveTenantMiddlewarePaths() {
    if (this.tenantMiddlewarePaths) return this.tenantMiddlewarePaths;

    return {
      http: renderLayerPath(`tenantScope`, `SHARED`, `httpMiddlewares`, {
        tenant_id: this.tenantId
      }),
      ws: renderLayerPath(`tenantScope`, `SHARED`, `wsMiddlewares`, {
        tenant_id: this.tenantId
      })
    };
  }

  #resolveAppMiddlewarePaths(appId, appRecord = null) {
    if (typeof this.appMiddlewarePathsResolver === `function`) {
      return this.appMiddlewarePathsResolver({
        tenantId: this.tenantId,
        appId,
        appRecord
      });
    }

    return {
      http: renderLayerPath(`appScope`, `RESOURCES`, `httpMiddlewares`, {
        tenant_id: this.tenantId,
        app_id: appId
      }),
      ws: renderLayerPath(`appScope`, `RESOURCES`, `wsMiddlewares`, {
        tenant_id: this.tenantId,
        app_id: appId
      })
    };
  }
}

async function loadProtocolRegistry(pathsByProtocol = {}) {
  return freezeProtocolRegistry({
    http: await loadMiddlewareRegistry(pathsByProtocol?.http ?? null),
    ws: await loadMiddlewareRegistry(pathsByProtocol?.ws ?? null)
  });
}

async function loadMiddlewareRegistry(directoryPath, {
  include = null
} = {}) {
  if (typeof directoryPath !== `string` || !directoryPath.trim()) return {};

  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === `ENOENT`) return {};
    throw error;
  }

  const registry = {};
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sortedEntries) {
    if (!entry?.isFile?.() || !entry.name.endsWith(`.js`)) continue;

    const middlewareName = path.basename(entry.name, path.extname(entry.name));
    if (!middlewareName || middlewareName.startsWith(`_`)) continue;
    if (typeof include === `function` && !include(middlewareName, entry.name)) continue;

    const sourcePath = path.join(directoryPath, entry.name);
    try {
      registry[middlewareName] = require(sourcePath);
    } catch (error) {
      throw new Error(`Couldn't load middleware ${sourcePath}: ${error?.message ?? error}`);
    }
  }

  return registry;
}

async function loadCoreMiddlewareOrder(directoryPath) {
  if (typeof directoryPath !== `string` || !directoryPath.trim()) {
    throw new Error(`middleware-stack-resolver requires a core middlewares directory`);
  }

  const manifestPath = path.join(directoryPath, `core.js`);
  let manifest = null;
  try {
    manifest = require(manifestPath);
  } catch (error) {
    throw new Error(`Couldn't load core middleware manifest ${manifestPath}: ${error?.message ?? error}`);
  }

  if (!Array.isArray(manifest)) {
    throw new Error(`Core middleware manifest ${manifestPath} must export an array`);
  }

  const normalizedManifest = manifest
    .map((middlewareName) => String(middlewareName ?? ``).trim())
    .filter(Boolean);

  if (normalizedManifest.some((middlewareName) => !middlewareName.startsWith(`core-`))) {
    throw new Error(`Core middleware manifest ${manifestPath} may reference only core-* middleware labels`);
  }

  return Object.freeze(normalizedManifest);
}

function validateCoreMiddlewareManifest(coreMiddlewareOrder, coreMiddlewares) {
  for (const middlewareName of coreMiddlewareOrder) {
    if (!(middlewareName in coreMiddlewares)) {
      throw new Error(`Core middleware manifest references missing middleware "${middlewareName}"`);
    }
  }
}

function normalizeKey(value) {
  const normalized = String(value ?? ``).trim().toLowerCase();
  return normalized || null;
}

function freezeRegistry(registry = {}) {
  return Object.freeze({ ...registry });
}

function freezeProtocolRegistry(registry = {}) {
  return Object.freeze({
    http: freezeRegistry(registry.http ?? {}),
    ws: freezeRegistry(registry.ws ?? {})
  });
}

module.exports = MiddlewareStackResolver;
Object.freeze(module.exports);
