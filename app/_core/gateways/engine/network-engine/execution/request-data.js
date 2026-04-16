// _core/gateways/engine/network-engine/execution/request-data.js


'use strict';


/** Request envelope that stores normalized inbound request metadata and payload details. */
class RequestData {
  requestId;
  method;
  url;
  headers;
  query;
  body;
  ip;
  cookie;

  constructor({
    requestId = null,
    method,
    url,
    headers = { cookie: {} },
    query = {},
    body = null,
    ip = null
  }) {
    this.requestId = requestId;
    this.method = method?.toUpperCase() || "GET";
    this.url = url || "/";
    this.headers = Object.freeze({ ...headers });
    this.query = Object.freeze({ ...query });
    this.body = body;
    this.ip = ip;

    const cookieParse = require(`@/utils/cookie/cookie-parse`);
    this.cookie = cookieParse(headers.cookie);

    Object.preventExtensions(this);
  }
}

module.exports = RequestData;
Object.freeze(module.exports);
