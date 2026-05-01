// _core/kernel/kernel-isolated-runtime.js


'use strict';


const RpcRuntime = require(`@/_core/runtimes/rpc-runtime`);
const KernelContext = require(`@/_core/kernel/kernel`);
const createPluginUseCases = require(`@/_core/boot/create-plugin-use-cases`);
const WsAppRuntime = require(`@/_core/runtimes/ws-app-runtime`);
const AppRpcRuntime = require(`@/_core/runtimes/app-rpc-runtime`);
const AppFluentFsRuntime = require(`@/_core/runtimes/app-fluent-fs-runtime/app-fluent-fs-runtime`);
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
 * @param {{config, processLabel, tenantId, appId, appRootFolder, tenantSharedRootFolder}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcRuntime,
 * storageService: StorageService, 
 * appFluentFsRuntime: AppFluentFsRuntime,
 * appRpcRuntime: AppRpcRuntime,
 * sharedCacheService: SharedCacheService,
 * wsAppRuntime: WsAppRuntime,
 * }}
 */
module.exports = async function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const useCases = {};
  kernelContext.useCases = useCases;
  const pathVariables = {
    tenant_id: globalCore.tenantId ?? null,
    app_id: globalCore.appId ?? null,
    tenant_domain: globalCore.tenantDomain ?? null,
    app_name: globalCore.appName ?? null
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
  useCases.appFluentFsRuntime = new AppFluentFsRuntime(kernelContext, {
    appRootFolder: globalCore.appRootFolder ?? null,
    tenantSharedRootFolder: globalCore.tenantSharedRootFolder ?? null
  });
  useCases.sharedCacheService = new SharedCacheService(kernelContext);
  useCases.rpcEndpoint = new RpcRuntime(kernelContext);
  useCases.appRpcRuntime = new AppRpcRuntime({
    rpcEndpoint: useCases.rpcEndpoint,
    tenantId: globalCore.tenantId,
    appId: globalCore.appId
  });
  useCases.wsAppRuntime = new WsAppRuntime({
    config: globalCore.config,
    rpcEndpoint: useCases.rpcEndpoint,
    tenantId: globalCore.tenantId,
    appId: globalCore.appId
  });

  return useCases;
}

Object.freeze(module.exports);
