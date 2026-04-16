// _core/kernel/kernel-manager.js


'use strict';


const RpcEndpoint = require(`g@/shared/rpc/rpc-endpoint`);
const QueueBroker = require(`g@/manager/queue-broker/queue-broker`);
const TenancyRouter = require(`g@/manager/tenancy-router/tenancy-router`);

//SERVICES
const StorageService = require(`g@/shared/storage-service/storage-service`);
const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);
const KernelContext = require(`@/_core/kernel/kernel`);

/**
 * @description
 * Initialize *Tenant* process boot.
 * Load predefined adapters.
 * Returns dependent gateways instance.
 * 
 * @param {{config, plugin}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcEndpoint,
 * queueBroker: QueueBroker,
 * tenancyRouter: TenancyRouter,
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
  gateways.queueBroker = new QueueBroker(kernelContext);
  gateways.tenancyRouter = new TenancyRouter(kernelContext);

  return gateways;
}

Object.freeze(module.exports);
