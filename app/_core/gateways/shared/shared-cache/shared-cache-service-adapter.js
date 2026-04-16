// _core/gateways/shared/shared-cache/shared-cache-service-adapter.js


'use strict';


/** Contract singleton for shared cache adapter operations and shutdown hooks. */
class SharedCacheServiceAdapter {
  /** @type {() => Promise<void>} */
  connectAdapter;
  /** @type {() => Promise<void>} */
  quitAdapter;
  /** @type {(params: { key: string, defaultValue?: any }) => Promise<any>} */
  getAdapter;
  /** @type {(params: { key: string, value: any, ttl?: number }) => Promise<any>} */
  setAdapter;
  /** @type {(params: { key: string }) => Promise<boolean>} */
  deleteAdapter;
  /** @type {(params: { prefix: string }) => Promise<number>} */
  deleteByPrefixAdapter;
  /** @type {(params: { key: string }) => Promise<boolean>} */
  hasAdapter;
  /** @type {(params: { key: string }) => Promise<any>} */
  getListAdapter;
  /** @type {(params: { key: string, value: any }) => Promise<any>} */
  appendListAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => this.quitAdapter?.();
}

module.exports = new SharedCacheServiceAdapter();
Object.preventExtensions(module.exports);
