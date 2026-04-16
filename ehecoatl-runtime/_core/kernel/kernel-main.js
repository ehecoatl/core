// _core/kernel/kernel-main.js


'use strict';


const RpcResolver = require(`@/_core/runtimes/rpc-runtime/rpc-resolver`);
const ProcessForkRuntime = require(`@/_core/runtimes/process-fork-runtime`);
const MultiProcessOrchestrator = require(`@/_core/orchestrators/multi-process-orchestrator`);
const WatchdogOrchestrator = require(`@/_core/orchestrators/watchdog-orchestrator`);
const KernelContext = require(`@/_core/kernel/kernel`);
const createPluginUseCases = require(`@/_core/boot/create-plugin-use-cases`);

/**
 * @description
 * Initialize *Ehecoatl* process boot.
 * Load predefined adapters.
 * Returns dependent useCases instance.
 * 
 * @param {{config, processLabel}} globalCore
 * 
 * @returns {{ 
 * rpcRouter: RpcResolver,
 * processForkRuntime: ProcessForkRuntime,
 * multiProcessOrchestrator: MultiProcessOrchestrator,
 * watchdogOrchestrator: WatchdogOrchestrator,
 * }}
 */
module.exports = async function kernel(globalCore) {
  const kernelContext = new KernelContext(globalCore);
  const useCases = {};
  kernelContext.useCases = useCases;
  Object.assign(useCases, await createPluginUseCases({
    config: globalCore.config,
    contextName: `MAIN`,
    processLabel: globalCore.processLabel
  }));
  kernelContext.pluginOrchestrator = useCases.pluginOrchestrator;
  kernelContext.pluginRegistryResolver = useCases.pluginRegistryResolver;
  useCases.rpcRouter = new RpcResolver(kernelContext);
  useCases.processForkRuntime = new ProcessForkRuntime(kernelContext);
  useCases.multiProcessOrchestrator = new MultiProcessOrchestrator(kernelContext);
  useCases.watchdogOrchestrator = new WatchdogOrchestrator(kernelContext);

  return useCases;
}

Object.freeze(module.exports);
