// adapters/engine/network-engine/uws/index.js


'use strict';


const NetworkEngineAdapter = require(`g@/engine/network-engine/network-engine-adapter`);
const uwsHttpHandler = require(`./uws-http-handler`);
const uWS = require("uWebSockets.js");

const forwardedHeaders = [
  `x-forwarded-for`,
  `cf-connecting-ip`,
  `true-client-ip`,
  `x-real-ip`
];

function getClientIp(req, res) {
  const forwarded = forwardedHeaders.find((h) => req.getHeader(h));
  if (forwarded) {
    return req.getHeader(forwarded).split(',')[0].trim();
  }
  const buf = res.getRemoteAddressAsText();
  return Buffer.from(buf).toString();
};

/**
 * 
 * @param {{
 *  services,
 *  networkConfig:typeof import('@/config/default.config').networkEngine,
 *  createExecutionContext: (param:any)=>import('g@/engine/network-engine/execution/execution-context')
 * }} param0 
 * @returns 
 */
NetworkEngineAdapter.setupAdapter = async function ({
  services,
  networkConfig,
  createExecutionContext
}) {
  const { hook } = services;
  const port = networkConfig.port ?? 443;
  const app = uWS.SSLApp({
    key_file_name: networkConfig.ssl.keyPath ?? null,
    cert_file_name: networkConfig.ssl.certPath ?? null,
  });

  //HTTP
  uwsHttpHandler.setup({
    app,
    getClientIp,
    networkConfig,
    createExecutionContext
  });

  await new Promise((resolve, reject) => {
    app.listen(port, (token) => {
      if (token) resolve();
      else reject(new Error("Port binding failed"));
    });
  });

  return { app };
};

module.exports = NetworkEngineAdapter;
Object.freeze(NetworkEngineAdapter);
