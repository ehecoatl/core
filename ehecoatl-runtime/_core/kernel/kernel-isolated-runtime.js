// _core/kernel/kernel-isolated-runtime.js


'use strict';


const RpcRuntime = require(`@/_core/runtimes/rpc-runtime`);
const KernelContext = require(`@/_core/kernel/kernel`);
const WebSocketManager = require(`@/_core/managers/web-socket-manager`);
const createPluginUseCases = require(`@/_core/boot/create-plugin-use-cases`);
const { renderLayerPath } = require(`@/contracts/utils`);

//SERVICES
const StorageService = require(`@/_core/services/storage-service`);
const SharedCacheService = require(`@/_core/services/shared-cache-service`);

/**
 * @description
 * Initialize *Isolated Runtime* process boot.
 * Load predefined adapters.
 * Returns dependent useCases instance.
 * 
 * @param {{config, processLabel, tenantId, appId}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcRuntime,
 * storageService: StorageService, 
 * sharedCacheService: SharedCacheService,
 * webSocketManager: WebSocketManager,
 * }}
 */
module.exports = async function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const useCases = {};
  kernelContext.useCases = useCases;
  const pathVariables = {
    tenant_id: globalCore.tenantId ?? null,
    app_id: globalCore.appId ?? null
  };
  const customPluginsPaths = [
    globalCore.config?.runtime?.customPluginsPath ?? null,
    renderLayerPath(`tenantScope`, `OVERRIDES`, `plugins`, pathVariables),
    renderLayerPath(`appScope`, `OVERRIDES`, `plugins`, pathVariables)
  ];
  Object.assign(useCases, await createPluginUseCases({
    config: globalCore.config,
    contextName: `ISOLATED_RUNTIME`,
    processLabel: globalCore.processLabel,
    customPluginsPaths
  }));
  kernelContext.pluginOrchestrator = useCases.pluginOrchestrator;
  kernelContext.pluginRegistryResolver = useCases.pluginRegistryResolver;

  useCases.storageService = new StorageService(kernelContext);
  useCases.sharedCacheService = new SharedCacheService(kernelContext);
  useCases.rpcEndpoint = new RpcRuntime(kernelContext);
  useCases.webSocketManager = new WebSocketManager(kernelContext);

  return useCases;
}

Object.freeze(module.exports);
