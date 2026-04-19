'use strict';

const path = require(`node:path`);
const contracts = require(`./index.js`);

function getAllProcesses() {
  return Object.values(getAllLayers()).flatMap((layer) => Object.values(getProcessContractsMap(layer)));
}

function getAllSnapshots() {
  return contracts.SNAPSHOTS ?? {};
}

function getAllLayers() {
  return contracts.LAYERS ?? {};
}

function inferProcessKey(processContract) {
  const explicitKey = processContract?.identity?.key ?? processContract?.identity?.processKey ?? null;
  if (explicitKey) return explicitKey;

  const explicitLabel = processContract?.identity?.label ?? null;
  if (explicitLabel && !explicitLabel.includes(`{`)) return explicitLabel;

  const entry = processContract?.bootstrap?.entry ?? null;
  if (!entry) return null;

  const baseName = path.basename(entry);
  if (!baseName.startsWith(`bootstrap-`)) return null;
  return baseName.slice(`bootstrap-`.length);
}

function getLayerContract(layerKey) {
  return getAllLayers()?.[layerKey] ?? null;
}

function getProcessContract(layerKey, processKey) {
  const layer = getLayerContract(layerKey);
  const processContract = getProcessContractsMap(layer)?.[processKey] ?? null;
  if (!processContract) return null;

  const inferredKey = inferProcessKey(processContract);
  if (inferredKey && inferredKey !== processKey) {
    throw new Error(`Process contract key mismatch for ${layerKey}.${processKey}: identity.key resolves to "${inferredKey}"`);
  }

  return processContract;
}

function getProcessIdentity(layerKey, processKey) {
  return getProcessContract(layerKey, processKey)?.identity ?? null;
}

function getRenderedProcessIdentity(layerKey, processKey, variables = {}) {
  const identity = getProcessIdentity(layerKey, processKey);
  if (!identity) return null;

  return Object.freeze({
    ...identity,
    label: typeof identity.label === `string` ? renderTemplate(identity.label, variables) : identity.label ?? null,
    user: typeof identity.user === `string` ? renderTemplate(identity.user, variables) : identity.user ?? null,
    group: typeof identity.group === `string` ? renderTemplate(identity.group, variables) : identity.group ?? null,
    secondGroup: typeof identity.secondGroup === `string`
      ? renderTemplate(identity.secondGroup, variables)
      : identity.secondGroup ?? null,
    thirdGroup: typeof identity.thirdGroup === `string`
      ? renderTemplate(identity.thirdGroup, variables)
      : identity.thirdGroup ?? null
  });
}

function getProcessBootstrapEntry(layerKey, processKey) {
  return getProcessContract(layerKey, processKey)?.bootstrap?.entry ?? null;
}

function getLayerPath(layerKey, category, item) {
  return getLayerPathEntry(layerKey, category, item)?.path ?? null;
}

function getLayerPathEntry(layerKey, category, item) {
  const layer = getLayerContract(layerKey);
  if (!layer) return null;

  const defaults = layer?.PATH_DEFAULTS ?? {};
  const categoryBlock = layer?.PATHS?.[String(category ?? ``).toUpperCase()] ?? null;
  const pathEntry = categoryBlock?.[item] ?? null;
  if (!Array.isArray(pathEntry) || typeof pathEntry[0] !== `string`) {
    return null;
  }

  return Object.freeze({
    path: pathEntry[0],
    owner: pathEntry[1] ?? defaults.owner ?? `root`,
    group: pathEntry[2] ?? defaults.group ?? `root`,
    mode: pathEntry[3] ?? defaults.mode ?? `0755`,
    recursive: pathEntry[4] ?? defaults.recursive,
    type: pathEntry[5] ?? defaults.type ?? `directory`
  });
}

function renderLayerPath(layerKey, category, item, variables = {}) {
  const layerPath = getLayerPath(layerKey, category, item);
  if (typeof layerPath !== `string` || !layerPath.length) return layerPath;
  return layerPath.includes(`{`)
    ? renderTemplate(layerPath, variables)
    : layerPath;
}

function renderLayerPathEntry(layerKey, category, item, variables = {}) {
  const pathEntry = getLayerPathEntry(layerKey, category, item);
  if (!pathEntry) return null;

  const renderValue = (value) => (
    typeof value === `string` && value.includes(`{`)
      ? renderTemplate(value, variables)
      : value
  );

  return Object.freeze({
    path: renderValue(pathEntry.path),
    owner: renderValue(pathEntry.owner),
    group: renderValue(pathEntry.group),
    mode: renderValue(pathEntry.mode),
    recursive: pathEntry.recursive,
    type: pathEntry.type
  });
}

function getLayerSymlink(layerKey, item) {
  const layer = getLayerContract(layerKey);
  if (!layer) return null;

  const symlinkEntry = layer?.SYMLINKS?.[item] ?? null;
  if (!Array.isArray(symlinkEntry) || typeof symlinkEntry[0] !== `string` || typeof symlinkEntry[1] !== `string`) {
    return null;
  }

  return Object.freeze({
    linkPath: symlinkEntry[0],
    targetPath: symlinkEntry[1]
  });
}

function renderLayerSymlink(layerKey, item, variables = {}) {
  const symlinkEntry = getLayerSymlink(layerKey, item);
  if (!symlinkEntry) return null;

  const renderValue = (value) => (
    typeof value === `string` && value.includes(`{`)
      ? renderTemplate(value, variables)
      : value
  );

  return Object.freeze({
    linkPath: renderValue(symlinkEntry.linkPath),
    targetPath: renderValue(symlinkEntry.targetPath)
  });
}

function getSupervisionScopePath(category, item) {
  return getLayerPath(`supervisionScope`, category, item);
}

function getInternalScopePath(category, item) {
  return getLayerPath(`internalScope`, category, item);
}

function getSnapshotContract(snapshotKey) {
  return getAllSnapshots()?.[snapshotKey] ?? null;
}

function renderTemplate(template, variables = {}) {
  return String(template ?? ``).replace(/\{([^}]+)\}/g, (_, key) => {
    const value = variables?.[key];
    if (value === undefined || value === null || String(value).trim() === ``) {
      throw new Error(`Missing value for process label variable "${key}"`);
    }
    return String(value).trim().toLowerCase();
  });
}

function getProcessLabel(layerKey, processKey, variables = {}) {
  const processContract = getProcessContract(layerKey, processKey);
  if (!processContract) return null;

  const labelTemplate = processContract?.identity?.label ?? inferProcessKey(processContract);
  if (!labelTemplate) return null;
  return labelTemplate.includes(`{`)
    ? renderTemplate(labelTemplate, variables)
    : labelTemplate;
}

function getProcessContractsMap(layer) {
  const processes = layer?.ACTORS?.PROCESSES ?? null;
  if (!processes || typeof processes !== `object`) {
    return Object.freeze({});
  }
  return processes;
}

module.exports = {
  getAllSnapshots,
  getAllLayers,
  getAllProcesses,
  getLayerContract,
  getLayerPath,
  getLayerPathEntry,
  renderLayerPath,
  renderLayerPathEntry,
  getLayerSymlink,
  renderLayerSymlink,
  getProcessContract,
  getProcessIdentity,
  getRenderedProcessIdentity,
  getProcessBootstrapEntry,
  getSnapshotContract,
  getSupervisionScopePath,
  getInternalScopePath,
  getProcessLabel,
  renderTemplate
};

Object.freeze(module.exports);
