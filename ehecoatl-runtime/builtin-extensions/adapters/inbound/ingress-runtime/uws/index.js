// adapters/inbound/ingress-runtime/uws/index.js


'use strict';

const uWS = require(`uWebSockets.js`);
const IngressRuntimePort = require(`@/_core/_ports/inbound/ingress-runtime-port`);
const httpHandler = require(`./http-handler`);
const wsHandler = require(`./ws-handler`);

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
 *  httpCoreIngressPort,
 *  wsCoreIngressPort,
 *  ingressRuntimeConfig:typeof import('@/config/default.config').ingressRuntime,
 *  createExecutionContext: (param:any)=>import('@/_core/runtimes/ingress-runtime/execution/execution-context')
 * }} param0 
 * @returns 
 */
IngressRuntimePort.setupAdapter = async function ({
  services,
  httpCoreIngressPort,
  wsCoreIngressPort,
  ingressRuntimeConfig,
  createExecutionContext
}) {
  const httpPort = httpCoreIngressPort ?? 14000;
  const wsPort = wsCoreIngressPort ?? 14000;

  //HTTP
  const httpApp = uWS.App();
  httpHandler.setup({
    httpApp,
    getClientIp,
    ingressRuntimeConfig,
    createExecutionContext
  });

  if (httpPort === wsPort) {
    //IF SAME PORT, SHARED APP
    let ports = { HTTP: httpPort, WS: wsPort };
    await portListen(_wsSetup(httpApp, ports));
    return true;
  } else {
    let ports = { HTTP: httpPort };
    await portListen({ app: httpApp, ports });
  }

  //WS Dedicated App (if not same port)
  const wsApp = uWS.App();
  await portListen(_wsSetup(wsApp, { WS: wsPort }))

  return true;

  function _wsSetup(app, ports) {
    wsHandler.setup({
      app,
      getClientIp,
      wsHubManager: services?.wsHubManager ?? null,
      ingressRuntimeConfig,
      createExecutionContext
    });
    return { app, ports };
  }
};

function portListen({ app, ports }) {
  return new Promise((resolve, reject) => {
    for (const label in ports) {
      app.listen("127.0.0.1", ports[label], (token) => {
        if (token) resolve();
        else reject(new Error(label + " TransportRuntime Port binding failed"));
      });
    }
  });
}

module.exports = IngressRuntimePort;
Object.freeze(IngressRuntimePort);
