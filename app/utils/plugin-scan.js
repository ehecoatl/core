// utils/plugin-scan.js


'use strict';


/**
 * @param {import('@/_core/boot/plugin-executor')} executor 
 * @param {string} customDir 
 * @param {Record<string, { enabled?: boolean }>} pluginsConfig
 * @param {string} contextName
 */
module.exports = async function (executor, customDir, pluginsConfig = {}, contextName = null) {
  const fs = require('fs/promises');
  const path = require('path');

  /** @type {Map<any,any>} */
  const plugins = new Map();
  const dirs = new Array(2);

  dirs[0] = path.resolve(__dirname, `..`, `plugins`); // MANDATORY
  dirs[1] = customDir;

  for (const dir of dirs) {
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (dirs.indexOf(dir) > 0) continue;
      else throw new Error(`Couldn't scan ${dir} plugins, check existence and config: ${e}`);
    }

    for (const entry of entries) {
      if (!entry.name.endsWith('.js') && !entry.isDirectory()) continue;
      const pluginConfigKey = entry.isDirectory()
        ? entry.name
        : path.basename(entry.name, path.extname(entry.name));
      const pluginConfig = pluginsConfig?.[pluginConfigKey] ?? {};
      if (pluginConfig.enabled === false) continue;
      const pluginPath = path.join(dir, entry.name);
      try {
        const plugin = require(entry.isDirectory() ? path.join(pluginPath, `index.js`) : pluginPath);
        if (!plugin || typeof plugin.register !== 'function') continue;
        const pluginName = plugin.name || entry.name;
        const effectiveConfig = {
          ...(pluginsConfig?.[pluginName] ?? {}),
          ...pluginConfig
        };
        const allowedContexts = effectiveConfig.contexts ?? plugin.contexts ?? null;
        if (Array.isArray(allowedContexts) && contextName && !allowedContexts.includes(contextName)) {
          continue;
        }

        await executor.registerPlugin(plugin, {
          configKey: pluginName,
          allowOverride: effectiveConfig.override === true
        });
        plugins.set(pluginName, plugin);
      } catch (e) {
        throw new Error(`Couldn't load plugin ${pluginPath} : ${e}`);
      }
    }
  }
  return plugins;
}
