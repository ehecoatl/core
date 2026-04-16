// utils/observability/request-correlation-id.js


'use strict';

const crypto = require(`node:crypto`);

const MAX_ID_LENGTH = 128;

function resolveRequestCorrelationId(headers = {}) {
  const incoming = readHeader(headers, `x-request-id`)
    ?? readHeader(headers, `x-correlation-id`);
  const normalized = normalizeId(incoming);
  if (normalized) {
    return {
      requestId: normalized,
      correlationId: normalized,
      generated: false
    };
  }

  const generatedId = generateRequestId();
  return {
    requestId: generatedId,
    correlationId: generatedId,
    generated: true
  };
}

function generateRequestId() {
  if (typeof crypto.randomUUID === `function`) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString(`hex`);
}

function readHeader(headers, key) {
  const direct = headers?.[key];
  if (typeof direct === `string`) return direct;

  const normalizedKey = String(key).toLowerCase();
  for (const [headerName, value] of Object.entries(headers ?? {})) {
    if (String(headerName).toLowerCase() !== normalizedKey) continue;
    return value;
  }
  return undefined;
}

function normalizeId(value) {
  if (value == null) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;

  const firstToken = stringValue.split(`,`)[0].trim();
  if (!firstToken) return null;

  // Allow a broad but safe token shape.
  const isSafe = /^[A-Za-z0-9._\-:/]+$/.test(firstToken);
  if (!isSafe) return null;

  return firstToken.slice(0, MAX_ID_LENGTH);
}

module.exports = Object.freeze({
  resolveRequestCorrelationId,
  generateRequestId
});
