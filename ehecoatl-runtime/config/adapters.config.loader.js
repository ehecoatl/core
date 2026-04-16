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

  resolveAdapterPath(`outbound`, `rpc-runtime`, `rpcRuntime`);
  resolveAdapterPath(`inbound`, `ingress-runtime`, `ingressRuntime`);
  resolveAdapterPath(`inbound`, `certificate-service`, `certificateService`);

  resolveAdapterPath(`outbound`, `process-fork-runtime`, `processForkRuntime`);

  resolveAdapterPath(`outbound`, `queue-manager`, `queueBroker`);
  resolveAdapterPath(`outbound`, `web-socket-manager`, `webSocketManager`);

  resolveAdapterPath(`outbound`, `tenant-directory-resolver`, `tenantDirectoryResolver`);
  resolveAdapterPath(`outbound`, `tenant-registry-resolver`, `tenantRegistryResolver`);
  resolveAdapterPath(`outbound`, `tenant-route-matcher-compiler`, `tenantRouteMatcherCompiler`);
  resolveAdapterPath(`outbound`, `i18n-compiler`, `i18nCompiler`);
  resolveAdapterPath(`outbound`, `request-uri-route-resolver`, `requestUriRouteResolver`);

  resolveAdapterPath(`outbound`, `storage-service`, `storageService`);
  resolveAdapterPath(`outbound`, `web-server-service`, `webServerService`);
  resolveAdapterPath(`outbound`, `shared-cache-service`, `sharedCacheService`);
};
