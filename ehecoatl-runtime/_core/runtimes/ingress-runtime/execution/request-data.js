// _core/runtimes/ingress-runtime/execution/request-data.js


'use strict';


/** Request envelope that stores normalized inbound request metadata and payload details. */
class RequestData {
  requestId;
  method;
  url;
  hostname;
  protocol;
  port;
  path;
  headers;
  query;
  body;
  ip;
  cookie;

  constructor({
    requestId = null,
    method,
    url,
    hostname = null,
    protocol = null,
    port = null,
    path = null,
    headers = { cookie: {} },
    query = {},
    body = null,
    ip = null
  }) {
    this.requestId = requestId;

    this.method = method?.toUpperCase() || "GET";
    this.url = url || "/";
    this.hostname = hostname ? String(hostname).trim().toLowerCase() : null;
    this.protocol = protocol ? String(protocol).trim().toLowerCase() : null;
    this.port = normalizePort(port);
    this.path = normalizePath(path);
    this.query = Object.freeze(normalizeQuery(query));
    this.body = body;
    this.ip = ip;

    this.headers = Object.freeze({ ...headers });
    const cookieParse = require(`@/utils/cookie/cookie-parse`);
    this.cookie = cookieParse(headers.cookie);

    Object.preventExtensions(this);
  }
}

module.exports = RequestData;
Object.freeze(module.exports);

function normalizeQuery(query) {
  if (!query) return {};
  if (typeof query === `string`) {
    const params = new URLSearchParams(query.startsWith(`?`) ? query.slice(1) : query);
    const normalized = {};
    for (const [key, value] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        const current = normalized[key];
        normalized[key] = Array.isArray(current)
          ? [...current, value]
          : [current, value];
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
  }
  if (typeof query === `object`) {
    return { ...query };
  }
  return {};
}

function normalizePath(pathname) {
  if (!pathname) return null;
  const value = String(pathname);
  return value.startsWith(`/`) ? value : `/${value}`;
}

function normalizePort(port) {
  if (port === null || port === undefined || port === ``) return null;
  const value = Number(port);
  return Number.isInteger(value) ? value : null;
}
