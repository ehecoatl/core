// _core/kernel/kernel.js


'use strict';


const BootResolver = require(`@/_core/boot/boot-resolver`);
const PluginExecutor = require('@/_core/boot/plugin-executor');
const Config = require(`@/config/default.config`);

/** Shared runtime container for config, plugin executor, and instantiated gateways. */
class KernelContext {
  config;
  plugin;
  gateways;

  /**
   * Stores shared runtime references and primes process-level exit handling once.
   * @param {{ config:Config, plugin:PluginExecutor }} globalCore
   */
  constructor({ config, plugin }) {
    this.config = config;
    this.plugin = plugin;
    this.gateways = {};

    BootResolver.setupExitHandlers();

    Object.preventExtensions(this);
  }

  /** Destroys instantiated gateways in reverse order to release process resources safely. */
  async destroy() {
    const gateways = Object.values(this.gateways ?? {}).reverse();
    for (const gateway of gateways) {
      await gateway?.destroy?.();
    }
  }
}

module.exports = KernelContext;

Object.freeze(module.exports);
