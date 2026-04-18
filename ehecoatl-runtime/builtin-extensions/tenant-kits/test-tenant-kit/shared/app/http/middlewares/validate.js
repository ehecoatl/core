'use strict';

module.exports = async function validateMiddleware(_, next) {
  await next();
};
