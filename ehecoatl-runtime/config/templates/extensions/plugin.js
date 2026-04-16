'use strict';

module.exports = {
  // Public plugin name used by the registry and config.plugins overrides.
  name: `custom-plugin`,

  // Lower priorities run first for the same hook.
  priority: 0,

  // Register hook listeners here with executor.on(...).
  // This is the main place for your custom plugin behavior.
  async register(executor) {
    void executor;
  },

  // Shared metadata passed when registering listeners.
  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    };
  }
};

Object.freeze(module.exports);
