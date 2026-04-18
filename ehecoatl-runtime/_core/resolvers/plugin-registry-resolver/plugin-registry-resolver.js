// _core/resolvers/plugin-registry-resolver/plugin-registry-resolver.js


'use strict';


const fs = require(`node:fs/promises`);
const path = require(`node:path`);

/** Resolves the ordered plugin registry for one process context without registering plugins. */
class PluginRegistryResolver {
  bundledPluginsPath;
  customPluginsPath;
  customPluginsPaths;
  pluginsConfig;

  constructor({
    bundledPluginsPath = path.resolve(__dirname, `..`, `..`, `..`, `builtin-extensions`, `plugins`),
    customPluginsPath = null,
    customPluginsPaths = null,
    pluginsConfig = {}
  } = {}) {
    this.bundledPluginsPath = bundledPluginsPath;
    this.customPluginsPath = customPluginsPath;
    this.customPluginsPaths = normalizePluginPaths(customPluginsPaths ?? [customPluginsPath]);
    this.pluginsConfig = pluginsConfig ?? {};
  }

  /** Resolves ordered plugin registry entries for one runtime context. */
  async resolveRegistryEntries(contextName, {
    customPluginsPath = this.customPluginsPath,
    customPluginsPaths = this.customPluginsPaths,
    pluginsConfig = this.pluginsConfig
  } = {}) {
    const registryEntries = [];
    const resolvedCustomPaths = normalizePluginPaths(customPluginsPaths ?? [customPluginsPath]);
    const directories = [this.bundledPluginsPath, ...resolvedCustomPaths];

    for (let i = 0; i < directories.length; i++) {
      const directory = directories[i];
      if (!directory) continue;
      const entries = await this.#readDirectory(directory, { optional: i > 0 });
      for (const entry of entries) {
        const registryEntry = this.#resolveRegistryEntry({
          entry,
          directory,
          contextName,
          pluginsConfig
        });
        if (!registryEntry) continue;
        registryEntries.push(registryEntry);
      }
    }

    return registryEntries;
  }

  /** Reads one plugin directory, optionally treating missing paths as absent custom inventory. */
  async #readDirectory(directory, { optional = false } = {}) {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (optional) return [];
      throw new Error(`Couldn't scan ${directory} plugins, check existence and config: ${error}`);
    }
  }

  /** Resolves one filesystem entry into a plugin registry record when the plugin is loadable. */
  #resolveRegistryEntry({
    entry,
    directory,
    contextName,
    pluginsConfig
  }) {
    if (!entry.name.endsWith(`.js`) && !entry.isDirectory()) return null;

    const pluginConfigKey = entry.isDirectory()
      ? entry.name
      : path.basename(entry.name, path.extname(entry.name));
    const pluginConfig = pluginsConfig?.[pluginConfigKey] ?? {};
    if (pluginConfig.enabled === false) return null;

    const sourcePath = path.join(directory, entry.name);
    const entryModulePath = entry.isDirectory()
      ? path.join(sourcePath, `index.js`)
      : sourcePath;
    if (entry.isDirectory()) {
      try {
        require(`node:fs`).accessSync(entryModulePath);
      } catch {
        return null;
      }
    }
    try {
      const plugin = require(entryModulePath);
      if (!plugin || typeof plugin.register !== `function`) return null;

      const pluginName = plugin.name || pluginConfigKey;
      const effectiveConfig = {
        ...(pluginsConfig?.[pluginName] ?? {}),
        ...pluginConfig
      };
      const allowedContexts = effectiveConfig.contexts ?? plugin.contexts ?? null;
      if (Array.isArray(allowedContexts) && contextName && !allowedContexts.includes(contextName)) {
        return null;
      }

      return Object.freeze({
        pluginName,
        plugin,
        configKey: pluginName,
        allowOverride: effectiveConfig.override === true,
        sourcePath
      });
    } catch (error) {
      throw new Error(`Couldn't load plugin ${sourcePath} : ${error}`);
    }
  }
}

module.exports = PluginRegistryResolver;

function normalizePluginPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const normalized = [];
  const seen = new Set();

  for (const targetPath of paths) {
    const value = typeof targetPath === `string`
      ? targetPath.trim()
      : ``;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}
