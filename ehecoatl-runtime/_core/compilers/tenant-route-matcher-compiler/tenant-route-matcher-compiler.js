// _core/compilers/tenant-route-matcher-compiler/tenant-route-matcher-compiler.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

class TenantRouteMatcherCompiler extends AdaptableUseCase {
  config;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.tenantRouteMatcherCompiler);
    this.config = kernelContext.config.adapters.tenantRouteMatcherCompiler ?? {};
  }

  async compileRoutes(routesAvailable = null) {
    const compileRoutesAdapter = this.adapter?.compileRoutesAdapter;
    if (typeof compileRoutesAdapter !== `function`) {
      return {
        routesAvailable: routesAvailable ?? null,
        compiledRoutes: []
      };
    }
    return await compileRoutesAdapter({
      config: this.config,
      routesAvailable
    });
  }
}

module.exports = TenantRouteMatcherCompiler;
Object.freeze(module.exports);
