// utils/deep-merge.js


'use strict';


function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseValue = result[key];
    const overrideValue = override[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) 
      result[key] = deepMerge(baseValue, overrideValue);
    else 
      result[key] = overrideValue;
  }
  return result;
}

Object.freeze(module.exports);