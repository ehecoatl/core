'use strict';

const path = require(`node:path`);

const {
  getLayerContract,
  renderLayerPathEntry,
  getRenderedProcessIdentity,
  renderTemplate
} = require(path.join(__dirname, `..`, `..`, `contracts`, `utils.js`));

function buildVariables({
  tenantId = null,
  appId = null,
  installId = null
} = {}) {
  return Object.freeze({
    tenant_id: tenantId ?? null,
    app_id: appId ?? null,
    install_id: installId ?? null
  });
}

function renderOptionalTemplate(value, variables = {}) {
  if (value == null) return null;
  if (typeof value !== `string`) return value;
  return value.includes(`{`) ? renderTemplate(value, variables) : value;
}

function getRenderedPathDefaults(layerKey, variables = {}) {
  const layer = getLayerContract(layerKey);
  if (!layer) return null;

  const defaults = layer.PATH_DEFAULTS ?? {};
  return Object.freeze({
    owner: renderOptionalTemplate(defaults.owner ?? null, variables),
    group: renderOptionalTemplate(defaults.group ?? null, variables),
    mode: defaults.mode ?? null,
    recursive: defaults.recursive ?? null
  });
}

function getRenderedShellIdentity(layerKey, variables = {}) {
  const layer = getLayerContract(layerKey);
  if (!layer) return null;

  const identity = layer?.ACTORS?.SHELL?.identity ?? null;
  if (!identity) return null;

  return Object.freeze({
    user: renderOptionalTemplate(identity.user ?? null, variables),
    group: renderOptionalTemplate(identity.group ?? null, variables)
  });
}

function getRenderedTenantFilesystemIdentity(tenantId) {
  return getRenderedPathDefaults(`tenantScope`, buildVariables({ tenantId }));
}

function getRenderedAppFilesystemIdentity(tenantId, appId) {
  return getRenderedPathDefaults(`appScope`, buildVariables({ tenantId, appId }));
}

function getRenderedScopeShellIdentity(layerKey, {
  tenantId = null,
  appId = null,
  installId = null
} = {}) {
  return getRenderedShellIdentity(layerKey, buildVariables({ tenantId, appId, installId }));
}

function getRenderedScopeProcessIdentity(layerKey, processKey, {
  tenantId = null,
  appId = null,
  installId = null
} = {}) {
  return getRenderedProcessIdentity(layerKey, processKey, buildVariables({ tenantId, appId, installId }));
}

function getRenderedScopePathEntry(layerKey, category, item, {
  tenantId = null,
  appId = null,
  installId = null
} = {}) {
  return renderLayerPathEntry(layerKey, category, item, buildVariables({ tenantId, appId, installId }));
}

module.exports = {
  buildVariables,
  getRenderedAppFilesystemIdentity,
  getRenderedPathDefaults,
  getRenderedScopePathEntry,
  getRenderedScopeProcessIdentity,
  getRenderedScopeShellIdentity,
  getRenderedShellIdentity,
  getRenderedTenantFilesystemIdentity
};

Object.freeze(module.exports);
