// _core/boot/create-plugin-use-cases.js


'use strict';


const PluginOrchestrator = require(`@/_core/orchestrators/plugin-orchestrator`);
const PluginRegistryResolver = require(`@/_core/resolvers/plugin-registry-resolver`);

/** Creates kernel-owned plugin useCases and registers the resolved plugin inventory. */
module.exports = async function createPluginUseCases({
  config,
  contextName,
  processLabel,
  customPluginsPaths = null
}) {
  const pluginOrchestrator = new PluginOrchestrator(processLabel, config.plugins);
  pluginOrchestrator.activateContext(contextName);

  const pluginRegistryResolver = new PluginRegistryResolver({
    customPluginsPaths: customPluginsPaths ?? [config.runtime?.customPluginsPath],
    pluginsConfig: config.plugins
  });
  const registryEntries = await pluginRegistryResolver.resolveRegistryEntries(contextName);

  for (const registryEntry of registryEntries) {
    await pluginOrchestrator.registerPlugin(registryEntry.plugin, {
      configKey: registryEntry.configKey,
      allowOverride: registryEntry.allowOverride
    });
  }

  return {
    pluginOrchestrator,
    pluginRegistryResolver
  };
};
