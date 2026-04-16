// utils/cookie/cookie-parse.js


'use strict';


module.exports = function parseCookie(cookieHeader) {
  const cookies = {};

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  const pairs = cookieHeader.split(';');

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const index = pair.indexOf('=');

    if (index === -1) continue;

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    if (!key) continue;

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
};
