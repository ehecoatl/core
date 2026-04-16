// config/defult.adapters.resolver.js


'use strict';


module.exports = (config) => {
  const varAdaptersDir = config.runtime.customAdaptersPath;
  function resolveAdapterPath(directionFolder, adaptableFolder, adapterId) {
    if (!(adapterId in config.adapters) || !(`adapter` in config.adapters[adapterId])) {
      throw new Error(`Failed loading ${directionFolder}/${adaptableFolder} adapter ${adapterId}`);
    }
    const a = `${directionFolder}/${adaptableFolder}/${config.adapters[adapterId].adapter}`;
    config._adapters[adapterId] = {
      bundled: `@adapter/${a}`,
      custom: `${varAdaptersDir}/${a}`,
      portPath: `@/_core/_ports/${directionFolder}/${adaptableFolder}-port`
    };
  }

  resolveAdapterPath(`inbound`, `rpc-runtime`, `rpcRuntime`);
  resolveAdapterPath(`inbound`, `ingress-runtime`, `ingressRuntime`);
  resolveAdapterPath(`outbound`, `certificate-service`, `certificateService`);

  resolveAdapterPath(`outbound`, `process-fork-runtime`, `processForkRuntime`);

  resolveAdapterPath(`inbound`, `queue-manager`, `queueBroker`);
  resolveAdapterPath(`inbound`, `ws-hub-manager`, `wsHubManager`);

  resolveAdapterPath(`inbound`, `tenant-directory-resolver`, `tenantDirectoryResolver`);
  resolveAdapterPath(`inbound`, `tenant-registry-resolver`, `tenantRegistryResolver`);
  resolveAdapterPath(`inbound`, `tenant-route-matcher-compiler`, `tenantRouteMatcherCompiler`);
  resolveAdapterPath(`inbound`, `i18n-compiler`, `i18nCompiler`);
  resolveAdapterPath(`inbound`, `e-renderer-runtime`, `eRendererRuntime`);
  resolveAdapterPath(`inbound`, `request-uri-routing-runtime`, `requestUriRoutingRuntime`);

  resolveAdapterPath(`outbound`, `storage-service`, `storageService`);
  resolveAdapterPath(`outbound`, `web-server-service`, `webServerService`);
  resolveAdapterPath(`outbound`, `shared-cache-service`, `sharedCacheService`);
};
