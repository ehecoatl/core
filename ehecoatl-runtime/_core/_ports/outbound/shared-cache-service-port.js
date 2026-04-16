// _core/_ports/outbound/services/shared-cache-service-port.js


'use strict';


/** Contract singleton for shared cache port operations and shutdown hooks. */
class SharedCacheServicePort {
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

module.exports = new SharedCacheServicePort();
Object.preventExtensions(module.exports);
