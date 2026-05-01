'use strict';

const ONE_SECOND_MS = 1000;

function normalizeRouteCachePolicy(cacheValue) {
  if (cacheValue == null) {
    return freezePolicy({
      cacheControl: null,
      internalTtlMs: null,
      explicitlyDisabled: false
    });
  }

  if (typeof cacheValue === `number` && Number.isFinite(cacheValue)) {
    return normalizeNumericSeconds(cacheValue);
  }

  if (typeof cacheValue === `string`) {
    const normalized = cacheValue.trim();
    if (!normalized) {
      return freezePolicy({
        cacheControl: null,
        internalTtlMs: null,
        explicitlyDisabled: false
      });
    }
    if (normalized.toLowerCase() === `no-cache`) {
      return freezePolicy({
        cacheControl: `no-cache`,
        internalTtlMs: null,
        explicitlyDisabled: true
      });
    }

    const numericSeconds = Number(normalized);
    if (Number.isFinite(numericSeconds)) {
      return normalizeNumericSeconds(numericSeconds);
    }

    return freezePolicy({
      cacheControl: normalized,
      internalTtlMs: parseCacheControlTtlMs(normalized),
      explicitlyDisabled: false
    });
  }

  return freezePolicy({
    cacheControl: null,
    internalTtlMs: null,
    explicitlyDisabled: false
  });
}

function clampRouteCacheTtl(policy, maxCacheTtlSeconds) {
  const routeTtlMs = normalizePositiveTtlMs(policy?.internalTtlMs);
  const maxTtlMs = normalizePositiveSeconds(maxCacheTtlSeconds);

  if (routeTtlMs == null && maxTtlMs == null) return undefined;
  if (routeTtlMs == null) return maxTtlMs;
  if (maxTtlMs == null) return routeTtlMs;
  return Math.min(routeTtlMs, maxTtlMs);
}

function normalizeNumericSeconds(seconds) {
  const normalizedSeconds = normalizePositiveSecondsValue(seconds);
  if (normalizedSeconds == null) {
    return freezePolicy({
      cacheControl: null,
      internalTtlMs: null,
      explicitlyDisabled: false
    });
  }

  return freezePolicy({
    cacheControl: `public, max-age=${normalizedSeconds}`,
    internalTtlMs: normalizedSeconds * ONE_SECOND_MS,
    explicitlyDisabled: false
  });
}

function parseCacheControlTtlMs(cacheControl) {
  const directives = parseCacheControlDirectives(cacheControl);
  const sharedMaxAge = normalizePositiveSecondsValue(directives.get(`s-maxage`));
  if (sharedMaxAge != null) return sharedMaxAge * ONE_SECOND_MS;

  const maxAge = normalizePositiveSecondsValue(directives.get(`max-age`));
  if (maxAge != null) return maxAge * ONE_SECOND_MS;

  return null;
}

function parseCacheControlDirectives(cacheControl) {
  const directives = new Map();
  for (const entry of String(cacheControl ?? ``).split(`,`)) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue;

    const [namePart, ...valueParts] = trimmedEntry.split(`=`);
    const name = String(namePart ?? ``).trim().toLowerCase();
    if (!name) continue;
    const value = valueParts.length > 0
      ? valueParts.join(`=`).trim().replace(/^"|"$/g, ``)
      : true;
    directives.set(name, value);
  }
  return directives;
}

function normalizePositiveSeconds(value) {
  const normalized = normalizePositiveSecondsValue(value);
  if (normalized == null) return null;
  return normalized * ONE_SECOND_MS;
}

function normalizePositiveSecondsValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.floor(numericValue);
}

function normalizePositiveTtlMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.floor(numericValue);
}

function freezePolicy({
  cacheControl,
  internalTtlMs,
  explicitlyDisabled
}) {
  return Object.freeze({
    cacheControl,
    internalTtlMs,
    explicitlyDisabled: explicitlyDisabled === true
  });
}

module.exports = {
  normalizeRouteCachePolicy,
  clampRouteCacheTtl
};

Object.freeze(module.exports);
