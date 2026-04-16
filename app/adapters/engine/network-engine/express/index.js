// adapters/engine/network-engine/express/index.js


'use strict';


const NetworkEngineAdapter = require(`g@/engine/network-engine/network-engine-adapter`);

NetworkEngineAdapter.setupAdapter = async function () {
  throw new Error(`Network adapter 'express' is not implemented`);
};

module.exports = NetworkEngineAdapter;
Object.freeze(NetworkEngineAdapter);
