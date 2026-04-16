'use strict';

module.exports = function normalizeRoutePath(value) {
  const normalizedValue = String(value ?? ``).trim();
  if (!normalizedValue) {
    return `/`;
  }

  let normalizedPath = normalizedValue.replace(/\/+/g, `/`);
  if (!normalizedPath.startsWith(`/`)) {
    normalizedPath = `/${normalizedPath}`;
  }

  if (normalizedPath.length > 1) {
    normalizedPath = normalizedPath.replace(/\/+$/g, ``);
  }

  return normalizedPath || `/`;
};

Object.freeze(module.exports);
