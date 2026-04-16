// adapters/outbound/web-server-service/create-native-tls-proxy.js


'use strict';

const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function loadPemMaybe(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== 'string') return value;

  // Heuristic: if it contains PEM header, treat as inline PEM content.
  if (value.includes('-----BEGIN ')) return value;

  // Otherwise treat as file path.
  return fs.readFileSync(value);
}

function createSecureContextFromSource(source) {
  const contextOptions = {
    key: loadPemMaybe(source.key),
    cert: loadPemMaybe(source.cert),
  };

  if (source.ca) {
    contextOptions.ca = Array.isArray(source.ca)
      ? source.ca.map(loadPemMaybe)
      : loadPemMaybe(source.ca);
  }

  if (source.passphrase) contextOptions.passphrase = source.passphrase;
  if (source.ciphers) contextOptions.ciphers = source.ciphers;
  if (source.minVersion) contextOptions.minVersion = source.minVersion;
  if (source.maxVersion) contextOptions.maxVersion = source.maxVersion;
  if (source.honorCipherOrder != null) {
    contextOptions.honorCipherOrder = !!source.honorCipherOrder;
  }

  return tls.createSecureContext(contextOptions);
}

function createTLSProxy({
  listenHost = '0.0.0.0',
  listenPort,
  targetHost = '127.0.0.1',
  targetPort,
  defaultSource,
  tcpNoDelay = true,
  keepAlive = true,
  keepAliveInitialDelay = 1000,
}) {
  if (!listenPort) {
    throw new Error('createTLSProxy: listenPort is required');
  }
  if (!targetPort) {
    throw new Error('createTLSProxy: targetPort is required');
  }
  if (!defaultSource || !defaultSource.key || !defaultSource.cert) {
    throw new Error('createTLSProxy: defaultSource with key and cert is required');
  }

  const sourceMap = new Map();

  const defaultTlsOptions = {
    key: loadPemMaybe(defaultSource.key),
    cert: loadPemMaybe(defaultSource.cert),
  };

  if (defaultSource.ca) {
    defaultTlsOptions.ca = Array.isArray(defaultSource.ca)
      ? defaultSource.ca.map(loadPemMaybe)
      : loadPemMaybe(defaultSource.ca);
  }
  if (defaultSource.passphrase) defaultTlsOptions.passphrase = defaultSource.passphrase;
  if (defaultSource.ciphers) defaultTlsOptions.ciphers = defaultSource.ciphers;
  if (defaultSource.minVersion) defaultTlsOptions.minVersion = defaultSource.minVersion;
  if (defaultSource.maxVersion) defaultTlsOptions.maxVersion = defaultSource.maxVersion;
  if (defaultSource.honorCipherOrder != null) {
    defaultTlsOptions.honorCipherOrder = !!defaultSource.honorCipherOrder;
  }

  const server = tls.createServer(defaultTlsOptions, (clientSocket) => {
    const upstreamSocket = net.connect({
      host: targetHost,
      port: targetPort,
    });

    if (tcpNoDelay) {
      clientSocket.setNoDelay(true);
      upstreamSocket.setNoDelay(true);
    }

    if (keepAlive) {
      clientSocket.setKeepAlive(true, keepAliveInitialDelay);
      upstreamSocket.setKeepAlive(true, keepAliveInitialDelay);
    }

    let closed = false;
    const safeDestroyBoth = () => {
      if (closed) return;
      closed = true;
      clientSocket.destroy();
      upstreamSocket.destroy();
    };

    clientSocket.on('error', safeDestroyBoth);
    upstreamSocket.on('error', safeDestroyBoth);

    clientSocket.on('end', () => upstreamSocket.end());
    upstreamSocket.on('end', () => clientSocket.end());

    clientSocket.on('close', () => {
      if (!upstreamSocket.destroyed) upstreamSocket.end();
    });

    upstreamSocket.on('close', () => {
      if (!clientSocket.destroyed) clientSocket.end();
    });

    // Bidirectional forwarding:
    // request bytes -> upstream
    clientSocket.pipe(upstreamSocket);

    // response bytes -> original client
    upstreamSocket.pipe(clientSocket);
  });

  function addSource({
    hostname,
    key,
    cert,
    ca,
    passphrase,
    ciphers,
    minVersion,
    maxVersion,
    honorCipherOrder,
  }) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) {
      throw new Error('addSource: hostname is required');
    }
    if (!key || !cert) {
      throw new Error('addSource: key and cert are required');
    }

    const source = {
      hostname: normalized,
      key,
      cert,
      ca,
      passphrase,
      ciphers,
      minVersion,
      maxVersion,
      honorCipherOrder,
    };

    const secureContext = createSecureContextFromSource(source);

    // Node supports adding SNI contexts per hostname or wildcard.
    server.addContext(normalized, secureContext.context || secureContext);

    sourceMap.set(normalized, {
      ...source,
      secureContext,
    });

    return handler;
  }

  function removeSource(hostname) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) return false;

    // Node TLS does not expose a public removeContext API.
    // We remove it from our registry, but existing addContext registrations
    // on the server are not cleanly removable without recreating the server.
    return sourceMap.delete(normalized);
  }

  function listen(callback) {
    server.listen(listenPort, listenHost, callback);
    return handler;
  }

  function close(callback) {
    server.close(callback);
    return handler;
  }

  function address() {
    return server.address();
  }

  function listSources() {
    return [...sourceMap.keys()];
  }

  const handler = {
    server,
    listen,
    close,
    address,
    addSource,
    removeSource,
    listSources,
  };

  return handler;
}

class TLSProxyHandler {

  constructor({
    server,
    listen,
    close,
    address,
    addSource,
    removeSource,
    listSources,
  }) {
    this.server = server;
    this.listen = listen;
    this.close = close;
    this.address = address;
    this.addSource = addSource;
    this.removeSource = removeSource;
    this.listSources = listSources;
  }
}

module.exports = {
  createTLSProxy,
  TLSProxyHandler
};
