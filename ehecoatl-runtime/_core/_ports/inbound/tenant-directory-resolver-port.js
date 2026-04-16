// _core/_ports/outbound/resolvers/tenant-directory-resolver-port.js


'use strict';


/** Contract singleton for tenant directory scanning and registry-building port methods. */
class TenantDirectoryResolverPort {
  /**
   * @type {(params: {
   * config: typeof import('@/config/default.config').adapters.tenantDirectoryResolver,
   * storage: import('@/_core/services/storage-service')
   * routeMatcherCompiler?: import('@/_core/compilers/tenant-route-matcher-compiler')
   * }) => Promise<void | {
   * registry?: any,
   * initialScan?: boolean,
   * changedHosts?: string[],
   * removedHosts?: string[],
   * activeApps?: Array<{ hostname: string, domain?: string, appName?: string, rootFolder?: string }>,
   * invalidApps?: Array<{
   * hostname: string,
   * rootFolder?: string,
   * scope?: string,
   * status?: string,
   * generatedAt?: string,
   * appConfigPath?: string,
   * error?: { name?: string, code?: string | null, message?: string }
   * }>
   * }>}
   */
  scanTenantsAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new TenantDirectoryResolverPort();
Object.preventExtensions(module.exports);
