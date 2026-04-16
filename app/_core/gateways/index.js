// _core/gateways/index.js


'use strict';


module.exports = {
  NetworkEngine: require(`g@/engine/network-engine/network-engine`),
  RequestPipeline: require(`g@/engine/request-pipeline/request-pipeline`),
  SessionRouter: require(`g@/engine/session-router/session-router`),

  ProcessSupervisor: require(`g@/main/process-supervisor/process-supervisor`),

  QueueBroker: require(`g@/manager/queue-broker/queue-broker`),
  TenancyRouter: require(`g@/manager/tenancy-router/tenancy-router`),

  RpcRouter: require(`g@/shared/rpc/rpc-router`),
  RpcEndpoint: require(`g@/shared/rpc/rpc-endpoint`),
  SharedCacheService: require(`g@/shared/shared-cache/shared-cache-service`),
  StorageService: require(`g@/shared/storage-service/storage-service`),
}
