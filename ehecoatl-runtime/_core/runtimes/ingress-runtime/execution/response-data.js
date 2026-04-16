// _core/runtimes/ingress-runtime/execution/response-data.js


'use strict';


/** Response envelope carrying status, headers, cookies, and body for one execution context. */
class ResponseData {
  headers;
  cookie;
  status;
  body;

  constructor() {
    this.headers = {};
    this.cookie = null;
    this.status = 200;
    this.body = null;

    Object.preventExtensions(this);
  }
}

module.exports = ResponseData;
Object.freeze(module.exports);
