// utils/http/http-response-write.js


'use strict';


const STATUS_TEXT = require(`@/config/http-status.config`);

function corkIfAvailable(res, writer) {
  if (typeof res?.cork === `function`) {
    res.cork(writer);
    return;
  }

  writer();
}

function toStatusLine(status = 200) {
  if (typeof status === `string`) {
    const normalized = status.trim();
    if (!normalized) return `200 ${STATUS_TEXT[200]}`;
    if (/^\d{3}\s+.+$/.test(normalized)) return normalized;

    const numericStatus = Number(normalized);
    if (Number.isInteger(numericStatus)) {
      return `${numericStatus} ${STATUS_TEXT[numericStatus] ?? STATUS_TEXT[500]}`;
    }

    return normalized;
  }

  const numericStatus = Number(status);
  if (Number.isInteger(numericStatus)) {
    return `${numericStatus} ${STATUS_TEXT[numericStatus] ?? STATUS_TEXT[500]}`;
  }

  return `200 ${STATUS_TEXT[200]}`;
}

function writeUwsResponseHead(res, {
  status = 200,
  headers = {}
} = {}) {
  res.writeStatus(toStatusLine(status));

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value == null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) res.writeHeader(key, String(item));
      }
      continue;
    }

    res.writeHeader(key, String(value));
  }
}

module.exports = {
  corkIfAvailable,
  toStatusLine,
  writeUwsResponseHead
};

Object.freeze(module.exports);
