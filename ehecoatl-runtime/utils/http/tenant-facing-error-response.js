// utils/http/tenant-facing-error-response.js


'use strict';


const STATUS_TEXT = require(`@/config/http-status.config`);

function createTenantFacingErrorResponse({
  status = 500,
  productionBody = null,
  nonProductionBody = null
  ,
  nonProductionDetails = null
} = {}) {
  const resolvedProductionBody = productionBody ?? STATUS_TEXT[status] ?? STATUS_TEXT[500];
  const resolvedNonProductionBody = nonProductionBody ?? resolvedProductionBody;

  return {
    status,
    headers: {
      'Content-Type': `text/plain; charset=utf-8`
    },
    body: isProductionEnvironment()
      ? resolvedProductionBody
      : appendNonProductionDetails(resolvedNonProductionBody, nonProductionDetails)
  };
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === `production`;
}

module.exports = {
  createTenantFacingErrorResponse,
  isProductionEnvironment
};

Object.freeze(module.exports);

function appendNonProductionDetails(body, details) {
  const normalizedDetails = normalizeDetails(details);
  if (!normalizedDetails.length) return body;
  return `${body}\n${normalizedDetails.join(`\n`)}`;
}

function normalizeDetails(details) {
  if (details == null) return [];
  if (Array.isArray(details)) {
    return details
      .map((entry) => typeof entry === `string` ? entry.trim() : ``)
      .filter(Boolean);
  }

  if (typeof details === `string`) {
    const trimmed = details.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}
