'use strict';

module.exports = async function wsMessageMiddleware(_, next) {
  await next();
};
