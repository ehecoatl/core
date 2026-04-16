// _core/kernel/kernel-tenant-app.js


'use strict';


const RpcEndpoint = require(`g@/shared/rpc/rpc-endpoint`);
const KernelContext = require(`@/_core/kernel/kernel`);

//SERVICES
const StorageService = require(`g@/shared/storage-service/storage-service`);
const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);

/**
 * @description
 * Initialize *Tenant App* process boot.
 * Load predefined adapters.
 * Returns dependent gateways instance.
 * 
 * @param {{config, plugin}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcEndpoint,
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

  return gateways;
}

Object.freeze(module.exports);
