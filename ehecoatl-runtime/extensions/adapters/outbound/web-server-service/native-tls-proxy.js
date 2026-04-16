// adapters/outbound/web-server-service/native-tls-proxy.js


'use strict';

const WebServerServicePort = require(`@/_core/_ports/outbound/web-server-service-port`);
const { createTLSProxy, TLSProxyHandler } = require(`@/extensions/adapters/outbound/web-server-service/create-native-tls-proxy`);

/** @type {TLSProxyHandler} */
let httpsTLSProxy;
/** @type {TLSProxyHandler} */
let wssTLSProxy;

/** @param {typeof import('@/config/default.config').webServerService} networkConfig */
WebServerServicePort.setupServerAdapter = async function (networkConfig = {}) {
  const targetHttpsPort = networkConfig.httpCoreIngressPort ?? 14000;
  const targetWssPort = networkConfig.wsCoreIngressPort ?? 14001;
  httpsTLSProxy = createTLSProxy({
    listenPort: networkConfig.httpsPort ?? 443,

    targetHost: '127.0.0.1',
    targetPort: targetHttpsPort,

    defaultSource: {
      key: './certs/default.key',
      cert: './certs/default.crt',
    },
  }).listen(() => {
    console.log(`HTTPS TLS proxy listening on ${targetHttpsPort}`);
  });

  wssTLSProxy = createTLSProxy({
    listenPort: networkConfig.wssPort ?? 443,

    targetHost: '127.0.0.1',
    targetPort: targetWssPort,

    defaultSource: {
      key: './certs/default.key',
      cert: './certs/default.crt',
    },
  }).listen(() => {
    console.log(`WSS TLS proxy listening on ${targetHttpsPort}`);
  });
};

WebServerServicePort.updateSourceAdapter = async function (source) {
  if (!httpsTLSProxy || !wssTLSProxy || !source?.tenantDomain || !source?.tls?.key || !source?.tls?.cert) {
    return null;
  }

  httpsTLSProxy.addSource({
    hostname: source.tenantDomain,
    key: source.tls.key,
    cert: source.tls.cert
  });
  wssTLSProxy.addSource({
    hostname: source.tenantDomain,
    key: source.tls.key,
    cert: source.tls.cert
  });
  return { changed: true, sourceKey: source.key ?? source.tenantId ?? source.tenantDomain };
};

WebServerServicePort.removeSourceAdapter = async function (sourceKey) {
  if (!httpsTLSProxy || !wssTLSProxy || !sourceKey) {
    return null;
  }

  const removedHttps = httpsTLSProxy.removeSource(sourceKey);
  const removedWss = wssTLSProxy.removeSource(sourceKey);
  return { changed: Boolean(removedHttps || removedWss), sourceKey };
};

WebServerServicePort.flushChangesAdapter = async function () {
  return {
    changed: false,
    tested: false,
    reloaded: false
  };
};

module.exports = WebServerServicePort;
Object.freeze(WebServerServicePort);
