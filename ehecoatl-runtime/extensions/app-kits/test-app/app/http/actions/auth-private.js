'use strict';

module.exports = {
  index({ sessionData, requestData }) {
    return {
      status: 200,
      body: {
        success: true,
        message: `private route granted`,
        auth: sessionData?.auth ?? null,
        path: requestData?.path ?? null,
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
