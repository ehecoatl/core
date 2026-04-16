// _core/_ports/adaptable-use-case.js


'use strict';


/** Base class for adapter-backed internal use cases connected through port contracts. */
class AdaptableUseCase {
  constructor(adapterPath = null) {
    this.adapter = null;
    this.adapterPath = adapterPath;
    this.loadAdapter();
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

module.exports = AdaptableUseCase;
Object.freeze(module.exports);
