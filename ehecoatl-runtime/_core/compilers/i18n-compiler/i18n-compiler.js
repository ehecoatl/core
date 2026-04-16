// _core/compilers/i18n-compiler/i18n-compiler.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

class I18nCompiler extends AdaptableUseCase {
  config;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.i18nCompiler);
    this.config = kernelContext.config.adapters.i18nCompiler ?? {};
    Object.freeze(this);
  }

  async replaceOneShot(source, pairsMap = null, keyMask = `?`, replaceMask = `?`) {
    const replaceOneShotAdapter = this.adapter?.replaceOneShotAdapter;
    if (typeof replaceOneShotAdapter !== `function`) {
      return String(source ?? ``);
    }
    return await replaceOneShotAdapter({
      config: this.config,
      source: String(source ?? ``),
      pairsMap,
      keyMask,
      replaceMask
    });
  }

  async compile(pairsMap = null, keyMask = `?`, replaceMask = `?`) {
    const compileAdapter = this.adapter?.compileAdapter;
    if (typeof compileAdapter !== `function`) {
      return (source) => String(source ?? ``);
    }
    return await compileAdapter({
      config: this.config,
      pairsMap,
      keyMask,
      replaceMask
    });
  }

  async replace(source, compiledReplacer = null) {
    const replaceAdapter = this.adapter?.replaceAdapter;
    if (typeof replaceAdapter !== `function`) {
      return String(source ?? ``);
    }
    return await replaceAdapter({
      config: this.config,
      source: String(source ?? ``),
      compiledReplacer
    });
  }
}

module.exports = I18nCompiler;
Object.freeze(module.exports);
