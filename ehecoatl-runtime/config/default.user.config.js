// config/defult.user.config.js


'use strict';


//This script initializes default config
//Override with /etc/opt/ehecoatl/config/{group}/{key}.json files if they exist, merging them with the default config
//instantiate adapters for core spawning

module.exports = async function loadUserConfig() {
  const defaultConfig = require(`@/config/default.config`);
  const adaptersConfigLoader = require(`@/config/adapters.config.loader`);

  const deepMerge = require(`@/utils/deep-merge`);
  const processConfigFolder = require(`@/config/config-resolver`);

  const etcDir = defaultConfig.runtime.customConfigPath;
  const userConfig = await processConfigFolder(etcDir, {
    runtime: {},
    plugins: {},
    adapters: {}
  });
  const mergedConfig = deepMerge(defaultConfig, userConfig);

  /** @type {import('@/config/default.config')} */
  const config = { ...mergedConfig, _adapters: {} };

  adaptersConfigLoader(config);

  return Object.freeze(config);
};

Object.freeze(module.exports);
