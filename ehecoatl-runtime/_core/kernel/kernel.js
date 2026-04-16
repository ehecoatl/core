// _core/kernel/kernel.js


'use strict';


const Config = require(`@/config/default.config`);

/** Shared runtime container for config, plugin use cases, and instantiated use cases. */
class KernelContext {
  config;
  pluginOrchestrator;
  pluginRegistryResolver;
  useCases;

  /**
   * Stores shared runtime references and primes process-level exit handling once.
   * @param {{ config:Config }} globalCore
   */
  constructor({ config }) {
    this.config = config;
    this.pluginOrchestrator = null;
    this.pluginRegistryResolver = null;
    this.useCases = {};

    Object.preventExtensions(this);
  }

  /** Destroys instantiated use cases in reverse order to release process resources safely. */
  async destroy() {
    const useCases = Object.values(this.useCases ?? {}).reverse();
    for (const useCase of useCases) {
      await useCase?.destroy?.();
    }
  }
}

module.exports = KernelContext;

Object.freeze(module.exports);
