'use strict';

const fs = require(`fs`);
const policy = require(`./runtime-policy.json`);

function getPolicy() {
  return policy;
}

function resolveProcessUser(label) {
  if (!label) return null;

  if (label === `main`) {
    return policy.processUsers?.main?.user ?? `root`;
  }

  if (label === `manager`) {
    return policy.processUsers?.manager?.user ?? `e_manager`;
  }

  if (label.startsWith(`engine_`)) {
    return policy.processUsers?.engine?.user ?? `e_engine`;
  }

  if (label.startsWith(`tenant_`)) {
    const prefix = policy.processUsers?.tenant?.prefix ?? `e_tenant_`;
    const tenantHost = label.slice(`tenant_`.length);
    return `${prefix}${tenantHost}`;
  }

  return `e_${label}`;
}

function resolveProcessGroup(label, processUser = resolveProcessUser(label)) {
  if (!label) return null;
  const sharedGroup = policy.system?.sharedGroup ?? `root`;

  if (label === `main`) {
    return policy.processUsers?.main?.group ?? sharedGroup;
  }

  if (label === `manager`) {
    return policy.processUsers?.manager?.group ?? sharedGroup;
  }

  if (label.startsWith(`engine_`)) {
    return policy.processUsers?.engine?.group ?? sharedGroup;
  }

  if (label.startsWith(`tenant_`)) {
    const tenantGroupMode = policy.processUsers?.tenant?.groupMode ?? `host-user`;
    if (tenantGroupMode === `shared-group`) {
      return policy.processUsers?.tenant?.group ?? sharedGroup;
    }
    if (tenantGroupMode === `fixed`) {
      return policy.processUsers?.tenant?.group ?? sharedGroup;
    }
    return lookupPrimaryGroupId(processUser) ?? sharedGroup ?? processUser;
  }

  return lookupPrimaryGroupId(processUser) ?? processUser;
}

function lookupPrimaryGroupId(user) {
  if (!user) return null;

  try {
    const passwdEntries = fs.readFileSync(`/etc/passwd`, `utf8`).split(`\n`);
    const entry = passwdEntries.find((line) => line.startsWith(`${user}:`));
    if (!entry) return null;

    const gid = Number(entry.split(`:`)[3]);
    return Number.isInteger(gid) ? gid : null;
  } catch {
    return null;
  }
}

function getFirewallCommandArgs(kind) {
  const firewallPolicy = policy.firewall ?? {};
  switch (kind) {
    case `setup`:
      return [firewallPolicy.setupCommand ?? `ehecatl`, ...(firewallPolicy.setupArgs ?? [`firewall_setup`])];
    case `release`:
      return [firewallPolicy.releaseCommand ?? `ehecatl`, ...(firewallPolicy.releaseArgs ?? [`firewall_release`])];
    default:
      return null;
  }
}

module.exports = {
  getPolicy,
  resolveProcessUser,
  resolveProcessGroup,
  getFirewallCommandArgs
};

Object.freeze(module.exports);
