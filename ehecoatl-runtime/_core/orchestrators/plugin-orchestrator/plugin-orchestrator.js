// _core/orchestrators/plugin-orchestrator/plugin-orchestrator.js


'use strict';


const pluginHooks = require(`@/config/plugin-hooks.config`);

/** Orchestrates plugin listener registration and hook execution for one process context. */
class PluginOrchestrator {
  /** @type {pluginHooks} */
  hooks;
  processLabel;

  plugins;
  listeners;

  min;
  max;
  sharedMin;
  sharedMax;
  currentContextName;
  pluginsConfig;

  /** Initializes listener storage and binds the process label used in hook contexts. */
  constructor(processLabel = null, pluginsConfig = {}) {
    this.hooks = pluginHooks;
    this.processLabel = processLabel ?? process.env.PROCESS_LABEL ?? process.title ?? null;
    this.plugins = new Map();
    this.listeners = new Array(pluginHooks.MAX_HOOKS);
    this.pluginsConfig = pluginsConfig ?? {};
    this.currentContextName = null;
    this.min = null;
    this.max = null;
    this.sharedMin = null;
    this.sharedMax = null;
  }

  /** Activates one plugin hook context and configures accessible hook ranges. */
  activateContext(contextName) {
    if (!(contextName in pluginHooks)) {
      throw new Error(`Plugin context ${contextName} doesn't exist, check spelling`);
    }

    this.currentContextName = contextName;
    this.min = pluginHooks[contextName].min;
    this.max = pluginHooks[contextName].max;
    this.sharedMin = pluginHooks.SHARED?.min ?? null;
    this.sharedMax = pluginHooks.SHARED?.max ?? null;
    return this;
  }

  /** Registers a listener for one hook id and sorts it by ascending priority. */
  on(id, fn, { plugin = `anonymous`, priority = 0 } = {}) {
    if (!this.#hasAccessToHook(id)) return;
    if (id >= this.listeners.length) return;
    if (!this.listeners[id]) { this.listeners[id] = []; }
    const list = this.listeners[id];
    list.push({ fn, plugin, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  /** Removes a previously registered listener from one hook id. */
  off(id, fn) {
    if (!this.#hasAccessToHook(id)) return;
    const list = this.listeners[id];
    if (!list) return;
    const i = list.findIndex((hookListener) => hookListener.fn === fn);
    if (i !== -1) list.splice(i, 1);
  }

  /** Executes all listeners for a hook and forwards failures to an optional error hook. */
  async run(hook, context, errHook = null) {
    await this.runWithContext(hook, context, { errHook });
  }

  /** Executes a hook and returns the final hook context, optionally rethrowing listener errors. */
  async runWithContext(hook, context, { errHook = null, rethrow = false } = {}) {
    if (!this.#hasAccessToHook(hook)) return;
    const list = this.listeners[hook];
    const hookContext = this.#createHookContext(context);
    if (!list) return hookContext;
    for (const listener of list) {
      if (hookContext?.aborted) break;
      try {
        await Promise.resolve().then(() => listener.fn(hookContext));
      } catch (error) {
        if (errHook && errHook !== hook) {
          await this.run(errHook, { error, context: hookContext, hook });
        }
        if (rethrow) throw error;
      }
    }
    return hookContext;
  }

  /** Registers one plugin module, enforcing duplicate-name policy and optional replacement. */
  async registerPlugin(plugin, {
    configKey = null,
    allowOverride = false
  } = {}) {
    if (!plugin || typeof plugin.register !== `function`) return false;

    const pluginName = plugin.name || configKey || `anonymous`;
    if (this.plugins.has(pluginName)) {
      if (!allowOverride) {
        throw new Error(
          `Duplicate plugin name "${pluginName}" is not allowed without config.plugins.${pluginName}.override = true`
        );
      }
      await this.unload(pluginName, {
        reason: `replace`,
        replacedBy: pluginName
      });
    }

    await plugin.register(this);
    this.plugins.set(pluginName, plugin);
    return pluginName;
  }

  /** Unloads all listeners owned by one plugin and removes it from the loaded plugin map. */
  async unload(pluginName, {
    reason = `unload`,
    replacedBy = null
  } = {}) {
    if (!this.plugins) { throw new Error(`Plugin is not initialized yet`); }
    if (!this.plugins.has(pluginName)) { throw new Error(`Plugin ${pluginName} hasn't been loaded yet, check`); }

    const plugin = this.plugins.get(pluginName);
    await this.#teardownPlugin(pluginName, plugin, { reason, replacedBy });

    for (const key in this.listeners) {
      const list = this.listeners[key];
      if (!list) continue;
      this.listeners[key] = list.filter((hookListener) => hookListener.plugin !== pluginName);
    }
    this.plugins.delete(pluginName);
  }

  /** Returns resolved config for one plugin key from the active plugins config object. */
  getPluginConfig(pluginName) {
    if (!pluginName) return {};
    const config = this.pluginsConfig?.[pluginName];
    if (!config || typeof config !== `object`) return {};
    return { ...config };
  }

  /** Unloads loaded plugins in reverse registration order to release plugin resources safely. */
  async destroy() {
    const failures = [];
    const pluginNames = Array.from(this.plugins.keys()).reverse();
    for (const pluginName of pluginNames) {
      try {
        await this.unload(pluginName, { reason: `destroy` });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw failures[0];
    }
  }

  /** Checks whether a hook id belongs to the active context or shared hook ranges. */
  #hasAccessToHook(hook) {
    const inContextRange = (hook <= this.max && hook >= this.min);
    const inSharedRange = (this.sharedMin !== null
      && this.sharedMax !== null
      && hook <= this.sharedMax
      && hook >= this.sharedMin);
    return (inContextRange || inSharedRange);
  }

  /** Normalizes hook payloads and injects the active process label into the context. */
  #createHookContext(context) {
    if (context && typeof context === `object`) {
      return { processLabel: this.processLabel, ...context };
    }
    return { processLabel: this.processLabel };
  }

  /** Runs the first-class teardown lifecycle before listeners are removed. */
  async #teardownPlugin(pluginName, plugin, { reason = `unload`, replacedBy = null } = {}) {
    const teardown = plugin?.teardown ?? plugin?.destroy ?? null;
    if (typeof teardown !== `function`) return;

    try {
      await teardown.call(plugin, {
        executor: this,
        pluginName,
        contextName: this.currentContextName ?? null,
        reason,
        replacedBy
      });
    } catch (error) {
      throw new Error(`Failed to teardown plugin "${pluginName}": ${error?.message ?? error}`);
    }
  }
}

module.exports = PluginOrchestrator;
