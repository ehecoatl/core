// utils/cookie/cookie-serialize.js


'use strict';


function formatExpires(date) {
  if (date instanceof Date) {
    return date.toUTCString();
  }
  return new Date(date).toUTCString();
}

function buildSingleCookie(name, config) {
  if (!name) {
    throw new TypeError('Cookie name is required');
  }

  let value;
  const parts = [];

  if (
    typeof config === 'string' ||
    typeof config === 'number' ||
    typeof config === 'boolean'
  ) {
    value = String(config);
    parts.push(`${name}=${encodeURIComponent(value)}`);
    return parts.join('; ');
  }

  if (!config || typeof config !== 'object') {
    throw new TypeError(`Invalid cookie config for "${name}"`);
  }

  value = config.value ?? '';
  parts.push(`${name}=${encodeURIComponent(String(value))}`);

  if (config.maxAge !== undefined)
    parts.push(`Max-Age=${Math.floor(config.maxAge)}`);

  if (config.expires !== undefined)
    parts.push(`Expires=${formatExpires(config.expires)}`);

  if (config.domain) { parts.push(`Domain=${config.domain}`); }
  if (config.path) { parts.push(`Path=${config.path}`); }
  if (config.secure) { parts.push('Secure'); }
  if (config.httpOnly) { parts.push('HttpOnly'); }

  if (config.sameSite) {
    const allowed = ['Strict', 'Lax', 'None'];
    const val =
      typeof config.sameSite === 'string'
        ? config.sameSite.charAt(0).toUpperCase() + config.sameSite.slice(1)
        : config.sameSite;

    if (!allowed.includes(val)) {
      throw new TypeError(`Invalid SameSite value for "${name}"`);
    }

    parts.push(`SameSite=${val}`);
  }

  return parts.join('; ');
}

module.exports = function serializeCookies(cookieObject) {
  if (!cookieObject || typeof cookieObject !== 'object') {
    throw new TypeError('Cookie object must be provided');
  }

  const headers = [];

  for (const name of Object.keys(cookieObject)) {
    headers.push(buildSingleCookie(name, cookieObject[name]));
  }

  return headers;
};

/**

const buildCookies = require('./cookie-builder');

const cookies = buildCookies({
  session: {
    value: "abc123",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 3600
  },

  theme: {
    value: "dark",
    path: "/",
    maxAge: 86400
  },

  locale: "pt-BR"
});

console.log(cookies);

 */
