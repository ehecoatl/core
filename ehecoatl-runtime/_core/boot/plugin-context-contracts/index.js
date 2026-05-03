'use strict';

const v1 = require(`./v1`);

const {
  BasePluginContextV1,
  MainPluginContextV1,
  DirectorPluginContextV1,
  TransportPluginContextV1,
  IsolatedRuntimePluginContextV1
} = v1;

const CONTRACTS = Object.freeze({
  [MainPluginContextV1.contractId]: MainPluginContextV1,
  [DirectorPluginContextV1.contractId]: DirectorPluginContextV1,
  [TransportPluginContextV1.contractId]: TransportPluginContextV1,
  [IsolatedRuntimePluginContextV1.contractId]: IsolatedRuntimePluginContextV1
});

function createPluginContextFactory({
  kernelContext,
  contextName,
  processLabel
} = {}) {
  return function createPluginContext({
    pluginName,
    contractId
  } = {}) {
    const Contract = CONTRACTS[contractId];
    if (!Contract) {
      throw new Error(
        `Plugin "${pluginName ?? `anonymous`}" requested unknown context contract "${contractId}" for ${contextName}`
      );
    }

    const pluginContext = new Contract({
      kernelContext,
      contextName,
      processLabel
    });
    const isValid = typeof Contract.validate === `function`
      ? Contract.validate(pluginContext)
      : BasePluginContextV1.validate(pluginContext);
    if (!isValid) {
      throw new Error(
        `Plugin "${pluginName ?? `anonymous`}" received invalid context contract "${contractId}" for ${contextName}`
      );
    }
    return pluginContext;
  };
}

module.exports = Object.freeze({
  ...v1,
  createPluginContextFactory
});
