// _core/gateways/gateway-core.js


'use strict';


/** Base gateway abstraction that lazy-loads adapters and exposes common cleanup behavior. */
class GatewayCore {
  constructor(adapterPath = null) {
    this.adapter = null;
    this.adapterPath = adapterPath;
  }

  loadAdapter() {
    if (this.adapter) return this.adapter;
    if (!this.adapterPath) return null;

    if (typeof this.adapterPath === `string`) {
      this.adapter = require(this.adapterPath);
      return this.adapter;
    }

    if (this.adapterPath?.bundled || this.adapterPath?.custom) {
      try { this.adapter = require(this.adapterPath.bundled); }
      catch { this.adapter = require(this.adapterPath.custom); }
    }

    return this.adapter;
  }

  async destroy() {
    await this.adapter?.destroyAdapter?.();
  }
}

module.exports = GatewayCore;
Object.freeze(module.exports);
