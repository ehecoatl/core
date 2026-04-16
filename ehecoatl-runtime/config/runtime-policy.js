'use strict';

const runtimePolicy = require(`./runtime-policy.json`);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getRuntimePolicy() {
  return clone(runtimePolicy);
}

module.exports = {
  getRuntimePolicy
};

Object.freeze(module.exports);
