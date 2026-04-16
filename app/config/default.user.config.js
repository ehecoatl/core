// config/defult.user.config.js


'use strict';


//This script initializes default config
//Override with /etc/opt/ehecatl/*.json files if they exist, merging them with the default config
//instantiate adapters for core spawning

module.exports = async function loadUserConfig() {
  const defaultConfig = require(`@/config/default.config`);

  const deepMerge = require(`@/utils/deep-merge`);
  const processConfigFolder = require(`@/utils/config-resolver`);

  const etcDir = defaultConfig.app.customConfigPath;
  const userConfig = await processConfigFolder(etcDir, defaultConfig);

  /** @type {import('@/config/default.config')} */
  const config = { ...deepMerge(defaultConfig, userConfig), _adapters: {} };

  //-----------------------------
  // ADAPTERS INSTANTIATION
  //--------------------------------

  const varAdaptersDir = config.app.customAdaptersPath;
  function loadAdapterPath(groupFolder, gatewayFolder, adapterId) {
    if (!(adapterId in config) || !(`adapter` in config[adapterId])) {
      throw new Error(`Failed loading ${groupFolder}/${gatewayFolder} adapter ${adapterId}`);
    }
    const a = `${groupFolder}/${gatewayFolder}/${config[adapterId].adapter}`;
    config._adapters[adapterId] = {
      bundled: `@/adapters/${a}`,
      custom: `${varAdaptersDir}/${a}`
    };
  }

  loadAdapterPath(`main`, `process-supervisor`, `processSupervisor`);

  loadAdapterPath(`engine`, `network-engine`, `networkEngine`);
  loadAdapterPath(`engine`, `request-pipeline`, `requestPipeline`);
  loadAdapterPath(`engine`, `session-router`, `sessionRouter`);

  loadAdapterPath(`manager`, `queue-broker`, `queueBroker`);
  loadAdapterPath(`manager`, `tenancy-router`, `tenancyRouter`);

  // Services -> External Business
  loadAdapterPath(`shared`, `rpc`, `rpc`);
  loadAdapterPath(`shared`, `storage-service`, `storageService`);
  loadAdapterPath(`shared`, `shared-cache`, `sharedCacheService`);

  return Object.freeze(config);
};

Object.freeze(module.exports);
