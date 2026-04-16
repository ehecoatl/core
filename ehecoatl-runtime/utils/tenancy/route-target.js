// utils/tenancy/route-target.js


'use strict';


const { normalizeRouteRunTarget } = require(`@/utils/tenancy/route-run-target`);

const ALLOWED_TARGET_TYPES = Object.freeze([`run`, `asset`, `redirect`]);
const ALLOWED_REDIRECT_STATUS_CODES = Object.freeze([301, 302, 307, 308]);
const DEFAULT_REDIRECT_STATUS = 302;
const TARGET_PATTERN = /^([a-z]+)(?:\s+(\d{3}))?\s*>\s*(.+)$/i;

function parseRouteTargetString(pointsTo) {
  const normalizedPointsTo = String(pointsTo ?? ``).trim();
  if (!normalizedPointsTo) {
    throw new Error(`Route target "pointsTo" must be a non-empty string`);
  }

  const match = normalizedPointsTo.match(TARGET_PATTERN);
  if (!match) {
    throw new Error(`Route target "${normalizedPointsTo}" must match "type [status] > target"`);
  }

  const targetType = String(match[1] ?? ``).trim().toLowerCase();
  const statusToken = String(match[2] ?? ``).trim();
  const targetValue = String(match[3] ?? ``).trim();

  if (!ALLOWED_TARGET_TYPES.includes(targetType)) {
    throw new Error(`Unsupported route target type "${targetType}" in "${normalizedPointsTo}"`);
  }
  if (!targetValue) {
    throw new Error(`Route target "${normalizedPointsTo}" must include a destination after ">"`);
  }

  const normalizedPoints = buildCanonicalPointsTo({
    targetType,
    targetValue,
    redirectStatus: null
  });

  if (targetType === `redirect`) {
    const redirectStatus = statusToken
      ? validateRedirectStatusCode(statusToken, normalizedPointsTo)
      : DEFAULT_REDIRECT_STATUS;

    return Object.freeze({
      pointsTo: buildCanonicalPointsTo({
        targetType,
        targetValue,
        redirectStatus
      }),
      target: Object.freeze({
        type: targetType,
        value: targetValue,
        redirect: Object.freeze({
          location: targetValue,
          status: redirectStatus
        }),
        run: null,
        asset: null
      })
    });
  }

  if (statusToken) {
    throw new Error(`Only redirect targets may declare an inline status code in "${normalizedPointsTo}"`);
  }

  if (targetType === `asset`) {
    return Object.freeze({
      pointsTo: normalizedPoints,
      target: Object.freeze({
        type: targetType,
        value: targetValue,
        redirect: null,
        run: null,
        asset: Object.freeze({
          path: normalizeAssetTarget(targetValue)
        })
      })
    });
  }

  const runTarget = normalizeRouteRunTarget({ run: targetValue });
  if (!runTarget.run || !runTarget.resource || !runTarget.action) {
    throw new Error(`Run target "${normalizedPointsTo}" could not be resolved to a valid action`);
  }

  return Object.freeze({
    pointsTo: normalizedPoints,
    target: Object.freeze({
      type: targetType,
      value: targetValue,
      redirect: null,
      asset: null,
      run: Object.freeze({
        resource: runTarget.resource,
        action: runTarget.action
      })
    })
  });
}

function buildCanonicalPointsTo({
  targetType,
  targetValue,
  redirectStatus
}) {
  if (targetType === `redirect`) {
    const statusPart = Number.isFinite(redirectStatus)
      ? ` ${redirectStatus}`
      : ``;
    return `${targetType}${statusPart} > ${targetValue}`;
  }
  return `${targetType} > ${targetValue}`;
}

function validateRedirectStatusCode(statusToken, originalValue) {
  const redirectStatus = Number.parseInt(statusToken, 10);
  if (!ALLOWED_REDIRECT_STATUS_CODES.includes(redirectStatus)) {
    throw new Error(
      `Redirect target "${originalValue}" must use one of ${ALLOWED_REDIRECT_STATUS_CODES.join(`, `)}`
    );
  }
  return redirectStatus;
}

function normalizeAssetTarget(targetValue) {
  return String(targetValue ?? ``)
    .trim()
    .replaceAll(`\\`, `/`);
}

module.exports = Object.freeze({
  ALLOWED_REDIRECT_STATUS_CODES,
  DEFAULT_REDIRECT_STATUS,
  parseRouteTargetString
});
