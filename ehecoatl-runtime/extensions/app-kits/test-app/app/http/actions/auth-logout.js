'use strict';

module.exports = {
  index({ sessionData }) {
    sessionData.destroySession?.();

    return {
      status: 200,
      body: {
        success: true,
        message: `logout successful`
      }
    };
  }
};

Object.freeze(module.exports);
