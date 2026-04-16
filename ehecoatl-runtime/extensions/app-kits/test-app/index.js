'use strict';

module.exports = {
  boot({ tenantHost, tenantLabel }) {
    return Object.freeze({
      tenantHost,
      tenantLabel,
      bootedAtUtc: new Date().toISOString()
    });
  },

};

Object.freeze(module.exports);
