// _core/kernel/kernel-transport.js


'use strict';


const RpcRuntime = require(`@/_core/runtimes/rpc-runtime`);
const IngressRuntime = require(`@/_core/runtimes/ingress-runtime`);
const MiddlewareStackOrchestrator = require(`@/_core/orchestrators/middleware-stack-orchestrator`);
const MiddlewareStackResolver = require(`@/_core/resolvers/middleware-stack-resolver`);
const KernelContext = require(`@/_core/kernel/kernel`);
const createPluginUseCases = require(`@/_core/boot/create-plugin-use-cases`);
const { renderLayerPath } = require(`@/contracts/utils`);

//SERVICES
const StorageService = require(`@/_core/services/storage-service`);
const SharedCacheService = require(`@/_core/services/shared-cache-service`);

module.exports = async function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const useCases = {};
  kernelContext.useCases = useCases;
  const customPluginsPaths = [
    globalCore.config?.runtime?.customPluginsPath ?? null,
    renderLayerPath(`tenantScope`, `OVERRIDES`, `plugins`, {
      tenant_id: globalCore.tenantId ?? null
    })
  ];
  Object.assign(useCases, await createPluginUseCases({
    config: globalCore.config,
    contextName: `TRANSPORT`,
    processLabel: globalCore.processLabel,
    customPluginsPaths
  }));
  kernelContext.pluginOrchestrator = useCases.pluginOrchestrator;
  kernelContext.pluginRegistryResolver = useCases.pluginRegistryResolver;

  useCases.storageService = new StorageService(kernelContext);
  useCases.sharedCacheService = new SharedCacheService(kernelContext);
  useCases.rpcEndpoint = new RpcRuntime(kernelContext);
  useCases.middlewareStackResolver = new MiddlewareStackResolver({
    config: globalCore.config,
    tenantId: globalCore.tenantId
  });
  await useCases.middlewareStackResolver.initialize();
  useCases.middlewareStackOrchestrator = new MiddlewareStackOrchestrator(kernelContext);
  useCases.ingressRuntime = new IngressRuntime(kernelContext);

  return useCases;
}

Object.freeze(module.exports);
