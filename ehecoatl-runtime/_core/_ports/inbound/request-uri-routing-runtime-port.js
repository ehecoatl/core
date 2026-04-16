// _core/_ports/inbound/request-uri-routing-runtime-port.js


'use strict';


/** Contract singleton for tenant URI router runtime matching against an active registry. */
class RequestUriRoutingRuntimePort {
  /** @type {(params: { url: string, registry?: any, defaultAppName?:any }) => Promise<any>} */
  matchRouteAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new RequestUriRoutingRuntimePort();
Object.preventExtensions(module.exports);
