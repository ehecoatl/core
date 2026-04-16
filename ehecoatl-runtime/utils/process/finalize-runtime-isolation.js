'use strict';

const { resolveGroupId } = require(`./system-identity`);
const { dropAllCapabilities } = require(`./seccomp`);

function finalizeRuntimeIsolation({
  env = process.env,
  processAdapter = process,
  resolveGroupIdFn = resolveGroupId,
  dropCapabilitiesFn = dropAllCapabilities
} = {}) {
  const groupResult = dropConfiguredSupplementaryScopeGroups({
    env,
    processAdapter,
    resolveGroupIdFn
  });

  const capabilityResult = dropCapabilitiesFn();

  return Object.freeze({
    success: true,
    skipped: false,
    droppedGroups: groupResult.droppedGroups,
    remainingGroups: groupResult.remainingGroups,
    capabilitiesDropped: capabilityResult?.applied === true,
    reason: null
  });
}

function dropConfiguredSupplementaryScopeGroups({
  env = process.env,
  processAdapter = process,
  resolveGroupIdFn = resolveGroupId
} = {}) {
  const groupNames = normalizeConfiguredScopeGroups(env);
  if (groupNames.length === 0) {
    return Object.freeze({
      success: true,
      skipped: true,
      droppedGroups: [],
      remainingGroups: normalizeCurrentSupplementaryGroups(processAdapter),
      reason: `no_configured_scope_groups`
    });
  }

  if (typeof processAdapter.setgroups !== `function`) {
    throw new Error(`Current process cannot change supplementary groups.`);
  }

  const targetGroupIds = new Set(groupNames.map((groupName) => resolveGroupIdFn(groupName)));
  const currentSupplementaryGroups = normalizeCurrentSupplementaryGroups(processAdapter);
  const remainingGroups = currentSupplementaryGroups.filter((groupId) => !targetGroupIds.has(groupId));
  if (remainingGroups.length === currentSupplementaryGroups.length) {
    return Object.freeze({
      success: true,
      skipped: true,
      droppedGroups: [],
      remainingGroups,
      reason: `scope_groups_not_present`
    });
  }

  processAdapter.setgroups(remainingGroups);

  return Object.freeze({
    success: true,
    skipped: false,
    droppedGroups: groupNames.filter((groupName) => targetGroupIds.has(resolveGroupIdFn(groupName))),
    remainingGroups,
    reason: null
  });
}

function normalizeConfiguredScopeGroups(env = process.env) {
  return [
    normalizeOptionalEnv(env?.PROCESS_SECOND_GROUP),
    normalizeOptionalEnv(env?.PROCESS_THIRD_GROUP)
  ].filter((value, index, array) => value != null && array.indexOf(value) === index);
}

function normalizeCurrentSupplementaryGroups(processAdapter = process) {
  if (typeof processAdapter.getgroups !== `function`) {
    return [];
  }

  const currentGid = typeof processAdapter.getgid === `function`
    ? processAdapter.getgid()
    : null;

  return [...new Set((processAdapter.getgroups() ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value !== currentGid)
  )].sort((left, right) => left - right);
}

function normalizeOptionalEnv(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === `` ? null : normalized;
}

module.exports = {
  finalizeRuntimeIsolation,
  dropConfiguredSupplementaryScopeGroups
};

Object.freeze(module.exports);
