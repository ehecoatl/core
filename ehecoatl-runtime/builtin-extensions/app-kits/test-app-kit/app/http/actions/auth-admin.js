'use strict';

module.exports = {
  index({ sessionData }) {
    return {
      status: 200,
      body: {
        success: true,
        message: `admin route granted`,
        auth: sessionData?.auth ?? null,
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
