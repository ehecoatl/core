'use strict';

const fs = require(`node:fs`);

const CAP_SETGID = 6n;
const CAP_SETUID = 7n;
const CAP_STATUS_FIELDS = [`CapInh`, `CapPrm`, `CapEff`, `CapBnd`, `CapAmb`];

function applyProcessIdentityFromEnv({
  requireIdentity = true,
  env = process.env,
  processAdapter = process,
  resolveUserIdFn = resolveUserId,
  resolveGroupIdFn = resolveGroupId,
  canApplyIdentityChangesFn = canApplyIdentityChanges
} = {}) {
  const processUser = readRequiredEnv(env, `PROCESS_USER`, requireIdentity);
  const processGroup = readRequiredEnv(env, `PROCESS_GROUP`, requireIdentity);
  const secondGroup = normalizeOptionalEnv(env.PROCESS_SECOND_GROUP);
  const thirdGroup = normalizeOptionalEnv(env.PROCESS_THIRD_GROUP);

  if (!processUser || !processGroup) {
    return Object.freeze({
      applied: false,
      skipped: true,
      reason: `missing_identity_env`
    });
  }

  const userId = resolveUserIdFn(processUser);
  const groupId = resolveGroupIdFn(processGroup);
  const secondGroupId = secondGroup == null ? null : resolveGroupIdFn(secondGroup);
  const thirdGroupId = thirdGroup == null ? null : resolveGroupIdFn(thirdGroup);
  const currentUid = typeof processAdapter.getuid === `function` ? processAdapter.getuid() : null;
  const currentGid = typeof processAdapter.getgid === `function` ? processAdapter.getgid() : null;
  const currentSupplementaryGroups = typeof processAdapter.getgroups === `function`
    ? normalizeGroupList(processAdapter.getgroups(), currentGid)
    : [];
  const desiredSupplementaryGroups = normalizeGroupList([
    secondGroupId,
    thirdGroupId
  ], groupId);
  const needsUidChange = currentUid !== null && currentUid !== userId;
  const needsGidChange = currentGid !== null && currentGid !== groupId;
  const needsSupplementaryGroupChange = !areEqualGroupLists(currentSupplementaryGroups, desiredSupplementaryGroups);

  if (!needsUidChange && !needsGidChange && !needsSupplementaryGroupChange) {
    return Object.freeze({
      applied: false,
      skipped: true,
      reason: `already_applied`,
      user: processUser,
      group: processGroup,
      secondGroup,
      thirdGroup
    });
  }

  if (!canApplyIdentityChangesFn({
    needsUidChange,
    needsGidChange,
    needsSupplementaryGroupChange,
    processAdapter
  })) {
    throw new Error(`Current process does not hold enough privilege to apply contract identity changes.`);
  }

  const supplementaryGroups = [secondGroup, thirdGroup].filter((value) => value != null);
  const supplementary = supplementaryGroups.length > 0 ? ` + ${supplementaryGroups.join(` + `)}` : ``;
  console.log(`Switching process privileges to ${processUser}:${processGroup}${supplementary}`);

  if (typeof processAdapter.setgroups === `function` && needsSupplementaryGroupChange) {
    processAdapter.setgroups(desiredSupplementaryGroups);
  }

  if (needsGidChange) {
    processAdapter.setgid(groupId);
  }

  if (needsUidChange) {
    processAdapter.setuid(userId);
  }

  return Object.freeze({
    applied: true,
    skipped: false,
    user: processUser,
    group: processGroup,
    secondGroup,
    thirdGroup
  });
}

function readRequiredEnv(env, name, requireIdentity) {
  const value = normalizeOptionalEnv(env?.[name]);
  if (value != null) return value;
  if (requireIdentity) {
    throw new Error(`Missing required process identity env: ${name}`);
  }
  return null;
}

function normalizeOptionalEnv(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === `` ? null : normalized;
}

function canApplyIdentityChanges({
  needsUidChange = false,
  needsGidChange = false,
  needsSupplementaryGroupChange = false,
  processAdapter = process
}) {
  if (typeof processAdapter.getuid === `function` && processAdapter.getuid() === 0) {
    return true;
  }

  if ((processAdapter.platform ?? process.platform) !== `linux`) {
    return false;
  }

  const capabilitySnapshot = readCapabilitySnapshot();
  if (needsUidChange && !capabilitySnapshot.has(CAP_SETUID)) return false;
  if ((needsGidChange || needsSupplementaryGroupChange) && !capabilitySnapshot.has(CAP_SETGID)) return false;
  return true;
}

function resolveUserId(user) {
  if (/^\d+$/.test(String(user))) return Number(user);
  const entry = lookupPasswdEntry(user);
  if (!entry) {
    throw new Error(`Unable to resolve uid for user "${user}"`);
  }
  return Number(entry.uid);
}

function resolveGroupId(group) {
  if (/^\d+$/.test(String(group))) return Number(group);
  const entry = lookupGroupEntry(group);
  if (!entry) {
    throw new Error(`Unable to resolve gid for group "${group}"`);
  }
  return Number(entry.gid);
}

function lookupPasswdEntry(user) {
  const line = readColonEntry(`/etc/passwd`, user);
  if (!line) return null;
  const [, , uid] = line.split(`:`);
  return uid == null ? null : { uid };
}

function lookupGroupEntry(group) {
  const line = readColonEntry(`/etc/group`, group);
  if (!line) return null;
  const [, , gid] = line.split(`:`);
  return gid == null ? null : { gid };
}

function readColonEntry(filePath, name) {
  const prefix = `${name}:`;
  const content = fs.readFileSync(filePath, `utf8`);
  return content.split(`\n`).find((line) => line.startsWith(prefix)) ?? null;
}

function normalizeGroupList(groups, currentGid = null) {
  const normalized = (Array.isArray(groups) ? groups : [])
    .filter((value) => value !== null && value !== undefined && value !== ``)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  return normalized.filter((value) => value !== currentGid).sort((a, b) => a - b);
}

function areEqualGroupLists(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function readCapabilitySnapshot() {
  const status = fs.readFileSync(`/proc/self/status`, `utf8`);
  const capabilityMasks = CAP_STATUS_FIELDS.map((fieldName) => {
    const match = status.match(new RegExp(`^${fieldName}:\\s*([0-9a-fA-F]+)$`, `m`));
    if (!match) return 0n;
    return BigInt(`0x${match[1]}`);
  });

  return {
    has(capabilityBit) {
      const mask = 1n << capabilityBit;
      return capabilityMasks.some((capabilitySet) => (capabilitySet & mask) !== 0n);
    }
  };
}

module.exports = {
  applyProcessIdentityFromEnv
};

Object.freeze(module.exports);
