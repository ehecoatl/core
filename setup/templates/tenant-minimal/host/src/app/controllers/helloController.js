'use strict';

module.exports = {
  index() {
    return {
      status: 200,
      body: {
        message: `hello world`,
        timestampUtc: new Date().toISOString()
      }
    };
  }
};

Object.freeze(module.exports);
