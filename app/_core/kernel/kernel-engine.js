// _core/kernel/kernel-engine.js


'use strict';


const RpcEndpoint = require(`g@/shared/rpc/rpc-endpoint`);
const NetworkEngine = require(`g@/engine/network-engine/network-engine`);
const RequestPipeline = require(`g@/engine/request-pipeline/request-pipeline`);
const SessionRouter = require(`g@/engine/session-router/session-router`);
const KernelContext = require(`@/_core/kernel/kernel`);

//SERVICES
const StorageService = require(`g@/shared/storage-service/storage-service`);
const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);

/**
 * @description
 * Initialize *Request Pipeline* process boot.
 * Load predefined adapters.
 * Returns dependent gateways instance.
 * 
 * @param {{config, plugin}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcEndpoint,
 * networkEngine: NetworkEngine,
 * requestPipeline: RequestPipeline,
 * sessionRouter: SessionRouter,
 * storageService: StorageService, 
 * sharedCacheService: SharedCacheService,
 * }}
 */
module.exports = function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const gateways = {};
  kernelContext.gateways = gateways;

  gateways.storageService = new StorageService(kernelContext);
  gateways.sharedCacheService = new SharedCacheService(kernelContext);
  gateways.rpcEndpoint = new RpcEndpoint(kernelContext);
  gateways.requestPipeline = new RequestPipeline(kernelContext);
  gateways.sessionRouter = new SessionRouter(kernelContext);
  gateways.networkEngine = new NetworkEngine(kernelContext);

  return gateways;
}

Object.freeze(module.exports);
