// utils/parse-bytes.js


'use strict';


module.exports = function parseSize(str) {
  const units = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4
  };

  const match = String(str).trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/);
  if (!match) throw new Error("Invalid size format");

  const value = parseFloat(match[1]);
  const unit = match[2];

  return Math.floor(value * units[unit]);
}
