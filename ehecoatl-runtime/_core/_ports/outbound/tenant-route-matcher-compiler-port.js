// _core/_ports/outbound/compilers/tenant-route-matcher-compiler-port.js


'use strict';


/** Contract singleton for tenant route normalization and first-match comparer compilation. */
class TenantRouteMatcherCompilerPort {
  /**
   * @type {(params: {
   * config?: typeof import('@/config/default.config').adapters.tenantRouteMatcherCompiler,
   * routesAvailable?: Record<string, any> | null
   * }) => Promise<{
   * routesAvailable: Record<string, any> | null,
   * compiledRoutes: any[]
   * }>}
   */
  compileRoutesAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new TenantRouteMatcherCompilerPort();
Object.preventExtensions(module.exports);
