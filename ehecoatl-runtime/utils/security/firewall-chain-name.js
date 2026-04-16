'use strict';

const crypto = require(`node:crypto`);

const LEGACY_INPUT_PREFIX = `EHECOATL_FW_INPUT_`;
const SHORT_INPUT_PREFIX = `EHECOATL_FW_I_`;
const MAX_CHAIN_NAME_LENGTH = 28;

function sanitizeFirewallToken(value) {
  return String(value ?? ``)
    .trim()
    .toUpperCase()
    .replace(/[.-]/g, `_`)
    .replace(/[^A-Z0-9_]/g, ``);
}

function resolveInboundFirewallChainName(processUser, label = ``) {
  const sanitizedUser = sanitizeFirewallToken(processUser) || `UNKNOWN`;
  const legacyChainName = `${LEGACY_INPUT_PREFIX}${sanitizedUser}`;
  if (legacyChainName.length <= MAX_CHAIN_NAME_LENGTH) {
    return legacyChainName;
  }

  const fingerprint = crypto
    .createHash(`sha1`)
    .update(`${processUser ?? ``}:${label ?? ``}`)
    .digest(`hex`)
    .slice(0, 10)
    .toUpperCase();
  return `${SHORT_INPUT_PREFIX}${fingerprint}`;
}

module.exports = {
  LEGACY_INPUT_PREFIX,
  SHORT_INPUT_PREFIX,
  MAX_CHAIN_NAME_LENGTH,
  sanitizeFirewallToken,
  resolveInboundFirewallChainName
};

Object.freeze(module.exports);
