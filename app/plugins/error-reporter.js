// plugins/error-reporter-listener.js


'use strict';

module.exports = {
  name: "error-reporter",
  priority: 0,

  /** @param {import('@/_core/boot/plugin-executor.js')} executor  */
  async register(executor) {
    const { PROCESS } = executor.hooks.MAIN;

    executor.on(PROCESS.ERROR, async (ctx) => {
      console.error(`[plugin:error-reporter]`, ctx?.error ?? ctx);
    }, this.pluginMeta);
  },

  get pluginMeta() {
    return {
      plugin: this.name,
      priority: this.priority
    }
  },
};

Object.freeze(module.exports);
