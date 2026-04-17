'use strict';

const fs = require(`node:fs`);
const path = require(`node:path`);

const KNOWN_SCOPES = new Set([`core`, `tenant`, `app`, `firewall`]);
const FORBIDDEN_OPERATOR_TOKENS = new Set([`;`, `&&`, `||`, `|`, `>`, `<`]);

function parseCommandLine(commandLine) {
  if (typeof commandLine !== `string`) {
    throw createInvalidCommandError(`commandLine must be a string`);
  }

  const trimmed = commandLine.trim();
  if (!trimmed) {
    throw createInvalidCommandError(`commandLine must not be empty`);
  }
  if (/[\u0000\r\n]/.test(trimmed)) {
    throw createInvalidCommandError(`commandLine contains unsupported control characters`);
  }

  const tokens = [];
  let current = ``;
  let quote = null;
  let escape = false;

  for (const char of trimmed) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (quote) {
      if (char === `\\`) {
        escape = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === `'` || char === `"`) {
      quote = char;
      continue;
    }

    if (char === `\\`) {
      escape = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = ``;
      }
      continue;
    }

    current += char;
  }

  if (escape || quote) {
    throw createInvalidCommandError(`commandLine contains an unterminated escape or quote`);
  }

  if (current) {
    tokens.push(current);
  }

  validateTokens(tokens);
  return tokens;
}

function validateTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw createInvalidCommandError(`commandLine must contain at least one token`);
  }

  for (const token of tokens) {
    if (!token || typeof token !== `string`) {
      throw createInvalidCommandError(`commandLine contains an invalid token`);
    }
    if (FORBIDDEN_OPERATOR_TOKENS.has(token)) {
      throw createInvalidCommandError(`commandLine contains a forbidden shell operator token`);
    }
    if (token.includes('`') || token.includes(`$(`)) {
      throw createInvalidCommandError(`commandLine contains a forbidden shell expansion token`);
    }
  }
}

function resolveEhecoatlCommand(commandLineOrTokens, { commandsDir } = {}) {
  const tokens = Array.isArray(commandLineOrTokens)
    ? [...commandLineOrTokens]
    : parseCommandLine(commandLineOrTokens);

  validateTokens(tokens);

  if (tokens[0] !== `ehecoatl`) {
    throw createInvalidCommandError(`Only commands with the "ehecoatl" prefix are allowed`);
  }

  const scope = tokens[1] ?? null;
  if (!KNOWN_SCOPES.has(scope)) {
    throw createInvalidCommandError(`Unknown or unsupported Ehecoatl CLI scope "${scope ?? `(missing)`}"`);
  }

  const firstCommandToken = tokens[2] ?? null;
  if (!firstCommandToken) {
    throw createInvalidCommandError(`Missing Ehecoatl CLI command after scope "${scope}"`);
  }

  const normalizedCommandsDir = commandsDir
    ? path.resolve(commandsDir)
    : null;
  if (!normalizedCommandsDir) {
    throw createInvalidCommandError(`commandsDir is required to resolve Ehecoatl CLI commands`);
  }

  const secondCommandToken = tokens[3] ?? null;
  const joinedCommandPath = secondCommandToken
    ? path.join(normalizedCommandsDir, scope, `${firstCommandToken}_${secondCommandToken}.sh`)
    : null;
  const singleCommandPath = path.join(normalizedCommandsDir, scope, `${firstCommandToken}.sh`);

  if (joinedCommandPath && fs.existsSync(joinedCommandPath)) {
    return Object.freeze({
      scope,
      commandFile: joinedCommandPath,
      commandTokens: [firstCommandToken, secondCommandToken],
      args: tokens.slice(4),
      normalizedCommandTokens: Object.freeze([`ehecoatl`, scope, firstCommandToken, secondCommandToken]),
      rawTokens: Object.freeze(tokens)
    });
  }

  if (fs.existsSync(singleCommandPath)) {
    return Object.freeze({
      scope,
      commandFile: singleCommandPath,
      commandTokens: [firstCommandToken],
      args: tokens.slice(3),
      normalizedCommandTokens: Object.freeze([`ehecoatl`, scope, firstCommandToken]),
      rawTokens: Object.freeze(tokens)
    });
  }

  throw createInvalidCommandError(`Ehecoatl CLI command is not available in this installation`);
}

function matchesAllowedPattern(pattern, actualCommandTokens) {
  const patternTokens = Array.isArray(pattern)
    ? [...pattern]
    : parseCommandLine(pattern);
  validateTokens(patternTokens);

  if (patternTokens[0] !== `ehecoatl`) {
    return false;
  }

  let patternIndex = 0;
  let actualIndex = 0;

  while (patternIndex < patternTokens.length && actualIndex < actualCommandTokens.length) {
    const patternToken = patternTokens[patternIndex];
    if (patternToken === `*`) {
      if (patternIndex === patternTokens.length - 1) {
        return actualIndex < actualCommandTokens.length;
      }
      patternIndex += 1;
      actualIndex += 1;
      continue;
    }

    if (patternToken !== actualCommandTokens[actualIndex]) {
      return false;
    }

    patternIndex += 1;
    actualIndex += 1;
  }

  if (patternIndex === patternTokens.length && actualIndex === actualCommandTokens.length) {
    return true;
  }

  return patternIndex === patternTokens.length - 1
    && patternTokens[patternIndex] === `*`
    && actualIndex < actualCommandTokens.length;
}

function normalizeAppRpcCliAppKey(tenantId, appId) {
  const normalizedTenantId = normalizeOpaqueId(tenantId);
  const normalizedAppId = normalizeOpaqueId(appId);
  if (!normalizedTenantId || !normalizedAppId) {
    return null;
  }
  return `${normalizedTenantId}/${normalizedAppId}`;
}

function normalizeOpaqueId(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function createInvalidCommandError(message) {
  const error = new Error(message);
  error.code = `INVALID_CLI_COMMAND`;
  return error;
}

module.exports = {
  KNOWN_SCOPES,
  parseCommandLine,
  resolveEhecoatlCommand,
  matchesAllowedPattern,
  normalizeAppRpcCliAppKey,
  createInvalidCommandError
};

Object.freeze(module.exports);
