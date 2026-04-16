// utils/tenancy/route-run-target.js


'use strict';


function normalizeRouteRunTarget({
  run,
  resource,
  action,
  call
} = {}) {
  if (typeof run === `string` && run.trim()) {
    return parseRunIdentifier(run);
  }

  const normalizedResource = normalizeResourceIdentifier(resource ?? action);
  if (!normalizedResource) {
    return {
      run: null,
      resource: null,
      action: null
    };
  }

  const normalizedAction = normalizeActionIdentifier(call) ?? `index`;
  return {
    run: `${normalizedResource}@${normalizedAction}`,
    resource: normalizedResource,
    action: normalizedAction
  };
}

function parseRunIdentifier(run) {
  const normalized = String(run ?? ``).trim().replaceAll(`\\`, `/`);
  if (!normalized) {
    return {
      run: null,
      resource: null,
      action: null
    };
  }

  const separatorIndex = normalized.indexOf(`@`);
  if (separatorIndex === -1) {
    const resource = normalizeResourceIdentifier(normalized);
    return {
      run: resource ? `${resource}@index` : null,
      resource,
      action: resource ? `index` : null
    };
  }

  const resource = normalizeResourceIdentifier(normalized.slice(0, separatorIndex));
  const action = normalizeActionIdentifier(normalized.slice(separatorIndex + 1)) ?? `index`;
  return {
    run: resource ? `${resource}@${action}` : null,
    resource,
    action: resource ? action : null
  };
}

function normalizeResourceIdentifier(resource) {
  const normalized = String(resource ?? ``).trim().replaceAll(`\\`, `/`);
  if (!normalized) return null;

  return normalized
    .replace(/^actions\//, ``)
    .replace(/\.js$/i, ``)
    .replace(/^\/+/, ``)
    .replace(/\/+/g, `/`)
    .trim() || null;
}

function normalizeActionIdentifier(action) {
  const normalized = String(action ?? ``).trim();
  return normalized || null;
}

module.exports = Object.freeze({
  normalizeRouteRunTarget,
  parseRunIdentifier
});
