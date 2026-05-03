// _core/kernel/kernel-director.js


'use strict';


const RpcRuntime = require(`@/_core/runtimes/rpc-runtime`);
const QueueManager = require(`@/_core/managers/queue-manager`);
const TenantDirectoryResolver = require(`@/_core/resolvers/tenant-directory-resolver`);
const TenantRegistryResolver = require(`@/_core/resolvers/tenant-registry-resolver`);
const TenantRouteMatcherCompiler = require(`@/_core/compilers/tenant-route-matcher-compiler`);
const RequestUriRoutingRuntime = require(`@/_core/runtimes/request-uri-routing-runtime`);

//SERVICES
const StorageService = require(`@/_core/services/storage-service`);
const CertificateService = require(`@/_core/services/certificate-service`);
const WebServerService = require(`@/_core/services/web-server-service`);
const SharedCacheService = require(`@/_core/services/shared-cache-service`);
const KernelContext = require(`@/_core/kernel/kernel`);
const createPluginUseCases = require(`@/_core/boot/create-plugin-use-cases`);

/**
 * @description
 * Initialize *Director* process boot.
 * Load predefined adapters.
 * Returns dependent useCases instance.
 * 
 * @param {{config, processLabel}} globalCore
 * 
 * @returns {{ 
 * rpcEndpoint: RpcRuntime,
 * queueBroker: QueueManager,
 * tenantDirectoryResolver: TenantDirectoryResolver,
 * tenantRegistryResolver: TenantRegistryResolver,
 * tenantRouteMatcherCompiler: TenantRouteMatcherCompiler,
 * requestUriRoutingRuntime: RequestUriRoutingRuntime,
 * storageService: StorageService,
 * certificateService: CertificateService,
 * webServerService: WebServerService,
 * sharedCacheService: SharedCacheService,
 * }}
 */
module.exports = async function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const useCases = {};
  kernelContext.useCases = useCases;
  Object.assign(useCases, await createPluginUseCases({
    config: globalCore.config,
    contextName: `DIRECTOR`,
    processLabel: globalCore.processLabel,
    kernelContext
  }));
  kernelContext.pluginOrchestrator = useCases.pluginOrchestrator;
  kernelContext.pluginRegistryResolver = useCases.pluginRegistryResolver;

  useCases.storageService = new StorageService(kernelContext);
  useCases.certificateService = new CertificateService(kernelContext);
  useCases.webServerService = new WebServerService(kernelContext);
  useCases.sharedCacheService = new SharedCacheService(kernelContext);
  useCases.rpcEndpoint = new RpcRuntime(kernelContext);
  useCases.queueBroker = new QueueManager(kernelContext);
  useCases.tenantDirectoryResolver = new TenantDirectoryResolver(kernelContext);
  useCases.tenantRegistryResolver = new TenantRegistryResolver(kernelContext);
  useCases.tenantRouteMatcherCompiler = new TenantRouteMatcherCompiler(kernelContext);
  useCases.requestUriRoutingRuntime = new RequestUriRoutingRuntime(kernelContext);
  useCases.tenantDirectoryResolver.attachTenantRegistryResolver(useCases.tenantRegistryResolver);
  useCases.tenantDirectoryResolver.attachRouteMatcherCompiler(useCases.tenantRouteMatcherCompiler);
  useCases.tenantDirectoryResolver.attachRouteRuntime(useCases.requestUriRoutingRuntime);
  useCases.tenantDirectoryResolver.attachWebServerService(useCases.webServerService);

  return useCases;
}

Object.freeze(module.exports);
