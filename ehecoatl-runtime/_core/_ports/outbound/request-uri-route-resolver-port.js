// _core/_ports/outbound/runtimes/request-uri-route-resolver-port.js


'use strict';


/** Contract singleton for tenant URI router runtime matching against an active registry. */
class RequestUriRouteResolverPort {
  /** @type {(params: { url: string, registry?: any, defaultAppName?:any }) => Promise<any>} */
  matchRouteAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new RequestUriRouteResolverPort();
Object.preventExtensions(module.exports);
