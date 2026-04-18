'use strict';

module.exports = async function assetMiddleware(_, next) {
  await next();
};
