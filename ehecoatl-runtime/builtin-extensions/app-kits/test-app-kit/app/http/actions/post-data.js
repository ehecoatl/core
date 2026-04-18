'use strict';

module.exports = {
  index({ requestData }) {
    return {
      status: 200,
      body: {
        message: `post data received`,
        method: requestData?.method ?? null,
        dataReceived: requestData?.body ?? null,
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
