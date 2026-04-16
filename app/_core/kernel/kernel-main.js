// _core/kernel/kernel-main.js


'use strict';


const RpcRouter = require(`g@/shared/rpc/rpc-router`);
const ProcessSupervisor = require(`g@/main/process-supervisor/process-supervisor`);
const KernelContext = require(`@/_core/kernel/kernel`);

/**
 * @description
 * Initialize *Ehecatl* process boot.
 * Load predefined adapters.
 * Returns dependent gateways instance.
 * 
 * @param {{config, plugin}} globalCore
 * 
 * @returns {{ 
 * rpcRouter: RpcRouter,
 * processSupervisor: ProcessSupervisor,
 * }}
 */
module.exports = function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const gateways = {};
  kernelContext.gateways = gateways;
  gateways.rpcRouter = new RpcRouter(kernelContext);
  gateways.processSupervisor = new ProcessSupervisor(kernelContext);

  return gateways;
}

Object.freeze(module.exports);
