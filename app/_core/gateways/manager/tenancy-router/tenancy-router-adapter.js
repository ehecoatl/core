// _core/gateways/manager/tenancy-router/tenancy-router-adapter.js


'use strict';


/** Contract singleton for tenant scanning and route-matching adapter methods. */
class TenancyRouterAdapter {
  /** @type {(params: { url: string }) => Promise<any>} */
  matchRouteAdapter;
  /**
   * @type {(params: {
   * config: typeof import('@/config/default.config')['tenancyRouter'],
   * storage: import('g@/shared/storage-service/storage-service')
   * }) => Promise<void | {
   * initialScan?: boolean,
   * changedHosts?: string[],
   * removedHosts?: string[],
   * activeHosts?: Array<{ host: string, rootFolder?: string }>,
   * invalidHosts?: Array<{
   * host: string,
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

module.exports = new TenancyRouterAdapter();
Object.preventExtensions(module.exports);
