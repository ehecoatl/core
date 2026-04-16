// _core/_ports/outbound/resolvers/tenant-registry-resolver-port.js


'use strict';


/** Contract singleton for persisting runtime tenant/app registry snapshots to disk. */
class TenantRegistryResolverPort {
  /**
   * @type {(params: {
   * config?: typeof import('@/config/default.config').adapters.tenantRegistryResolver,
   * storage: import('@/_core/services/storage-service'),
   * registry?: any,
   * scanSummary?: any,
   * tenantsPath: string,
   * registryPath: string
   * }) => Promise<{ registryPath: string, tenantCount: number, appCount: number }>}
   */
  persistRegistryAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new TenantRegistryResolverPort();
Object.preventExtensions(module.exports);
