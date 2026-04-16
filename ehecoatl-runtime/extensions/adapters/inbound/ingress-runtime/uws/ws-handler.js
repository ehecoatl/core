'use strict';

function extractHeaders(req) {
  const headers = {};
  req.forEach((key, value) => {
    headers[key] = value;
  });
  return headers;
}

module.exports.setup = function ({
  app,
  getClientIp,
  createWSClientContext
}) {
  app.ws(`/*`, {
    compression: 0,
    idleTimeout: 120,
    maxBackpressure: 1024 * 1024,
    maxPayloadLength: 16 * 1024 * 1024,
    upgrade(res, req, context) {
      const headers = extractHeaders(req);
      const ip = typeof getClientIp === `function` ? getClientIp(req, res) : null;
      const wsClientContext = typeof createWSClientContext === `function`
        ? createWSClientContext({ req, res, headers, ip })
        : null;

      res.upgrade(
        {
          headers,
          ip,
          wsClientContext
        },
        req.getHeader(`sec-websocket-key`),
        req.getHeader(`sec-websocket-protocol`),
        req.getHeader(`sec-websocket-extensions`),
        context
      );
    },
    open() {
      return true;
    },
    message() {
      return true;
    },
    close() {
      return true;
    }
  });
};

Object.freeze(module.exports);
