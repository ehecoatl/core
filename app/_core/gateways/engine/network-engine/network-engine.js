// _core/gateways/engine/network-engine/network-engine.js


'use strict';

const Network2ManagerResolver = require(`./network2manager-resolver`);
const Network2SessionResolver = require(`./network2session-resolver`);
const ExecutionContext = require(`g@/engine/network-engine/execution/execution-context`);
const GatewayCore = require(`g@/gateway-core`);
const StorageService = require(`g@/shared/storage-service/storage-service`);
const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);
const RpcEndpoint = require(`g@/shared/rpc/rpc-endpoint`);
const SessionRouter = require(`g@/engine/session-router/session-router`);

/** Engine gateway that binds network adapter I/O to execution contexts and manager services. */
class NetworkEngine extends GatewayCore {
  /** @type {typeof import('@/config/default.config').networkEngine} */
  config;
  startupPromise;
  routeCacheTTL;

  /** @type {Network2ManagerResolver} */
  managerResolver;
  /** @type {Network2SessionResolver} */
  sessionResolver;
  /** @type {import('g@/engine/request-pipeline/request-pipeline')} */
  requestPipeline;
  /** @type {SessionRouter} */
  sessionRouter;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./network-engine-adapter')}  */
  adapter = null;

  /** 
   * @type {{
   * storage: StorageService,
   * cache: SharedCacheService,
   * rpc: RpcEndpoint
   * }}
   * */
  services;

  /** Captures engine config, shared services, and boots the active network adapter. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.networkEngine);
    this.config = kernelContext.config.networkEngine;
    this.tenancyRouterConfig = kernelContext.config.tenancyRouter ?? {};
    this.routeCacheTTL = kernelContext.config.tenancyRouter?.routeMatchTTL ?? null;
    this.plugin = kernelContext.plugin;
    super.loadAdapter();
    this.rpcEndpoint = kernelContext.gateways.rpcEndpoint;
    this.requestPipeline = kernelContext.gateways.requestPipeline;
    this.sessionRouter = kernelContext.gateways.sessionRouter;
    this.storageService = kernelContext.gateways.storageService;
    this.sharedCacheService = kernelContext.gateways.sharedCacheService;

    this.services = Object.freeze({
      rpc: this.rpcEndpoint,
      cache: this.sharedCacheService,
      storage: this.storageService,
    });
    this.managerResolver = new Network2ManagerResolver(this);
    this.sessionResolver = new Network2SessionResolver(this);

    this.startupPromise = Promise.resolve(this.adapter.setupAdapter({
      services: this.services,
      networkConfig: this.config,
      createExecutionContext: this.createExecutionContext.bind(this)
    }));

    Object.freeze(this);
  }

  //TODO: pool recycling objects in future
  /** Creates one execution context instance for an inbound network request. */
  createExecutionContext(params) {
    return new ExecutionContext(this, params);
  }

  /**
   * Builds the request-scoped helper facade consumed by session-aware adapter code.
   * @param {ExecutionContext} ec
   */
  createSessionHelper(ec) {
    const s = this.sessionResolver;
    return Object.freeze({
      authSessionCSRF: async () => s.authSessionCSRF(ec),
      getSessionData: async () => s.getSessionData(ec),
      setCookiesSession: async () => s.setCookiesSession(ec),
      updateSessionData: async () => s.updateSessionData(ec),
    });
  }

  /**
   * Builds the request-scoped helper facade consumed by request pipeline stages.
   * @param {ExecutionContext} ec
   */
  createManagerHelper(ec) {
    const m = this.managerResolver;
    return Object.freeze({
      askManager: async (question, data) => await m.ask(question, data, ec),
      resolveRoute: async () => ec.tenantRoute = await m.resolveRoute(ec),
      getObject: async (key, defaultValue) => await m.getObject(key, defaultValue),
      setObject: async (key, value) => await m.setObject(key, value)
    });
  }

  /** Runs the HTTP request pipeline for one execution context. */
  runHttpPipeline(ec) {
    return this.requestPipeline.runHttpPipeline(ec);
  }
}

module.exports = NetworkEngine;
Object.freeze(module.exports);
