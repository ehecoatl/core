// _core/_ports/outbound/services/web-server-service-port.js


'use strict';


/** Contract singleton for director-managed web server lifecycle and registry updates. */
class WebServerServicePort {
  /** @type {(webServerConfig?: any) => Promise<any>} */
  setupServerAdapter;
  /** @type {(source: any, routeType?: string | null, webServerConfig?: any) => Promise<any>} */
  updateSourceAdapter;
  /** @type {(sourceKey: string, webServerConfig?: any) => Promise<any>} */
  removeSourceAdapter;
  /** @type {(webServerConfig?: any) => Promise<any>} */
  flushChangesAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new WebServerServicePort();
Object.preventExtensions(module.exports);
