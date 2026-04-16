'use strict';

const fs = require(`node:fs`);
const path = require(`node:path`);

const DEFAULT_MODE = `enforce`;
const VALID_MODES = new Set([`enforce`, `warn`]);
const DEFAULT_RUNTIME_CONFIG_DIR = `/etc/opt/ehecoatl/config`;
const SECURITY_CONFIG_PATH = path.join(DEFAULT_RUNTIME_CONFIG_DIR, `runtime`, `security.json`);
const ADDON_PATH = path.join(__dirname, `build`, `Release`, `ehecoatl_seccomp.node`);

let cachedAddon = undefined;

function normalizeMode(rawMode, sourceLabel) {
  const normalized = String(rawMode ?? DEFAULT_MODE).trim().toLowerCase();
  if (!VALID_MODES.has(normalized)) {
    throw new Error(`Unsupported seccomp mode "${rawMode}" from ${sourceLabel}. Expected "enforce" or "warn".`);
  }
  return normalized;
}

function resolveSeccompMode({
  env = process.env,
  securityConfigPath = SECURITY_CONFIG_PATH
} = {}) {
  if (env?.EHECOATL_SECCOMP_MODE) {
    return normalizeMode(env.EHECOATL_SECCOMP_MODE, `EHECOATL_SECCOMP_MODE`);
  }

  try {
    if (!fs.existsSync(securityConfigPath)) {
      return DEFAULT_MODE;
    }

    const parsed = JSON.parse(fs.readFileSync(securityConfigPath, `utf8`));
    const configuredMode = parsed?.seccomp?.mode;
    if (configuredMode == null) {
      return DEFAULT_MODE;
    }
    return normalizeMode(configuredMode, securityConfigPath);
  } catch (error) {
    error.message = `Failed to resolve seccomp mode from ${securityConfigPath}: ${error.message}`;
    throw error;
  }
}

function loadNativeSeccompAddon({
  allowUnavailable = false,
  addonPath = ADDON_PATH
} = {}) {
  if (cachedAddon !== undefined) {
    return cachedAddon;
  }

  try {
    cachedAddon = require(addonPath);
    return cachedAddon;
  } catch (error) {
    if (allowUnavailable) {
      return null;
    }
    error.message = `Failed to load native seccomp addon at ${addonPath}: ${error.message}`;
    throw error;
  }
}

function applyNoSpawnFilter({
  mode = DEFAULT_MODE,
  processLabel = process.env.PROCESS_LABEL ?? process.title ?? `unknown`,
  loadAddon = loadNativeSeccompAddon,
  logger = console
} = {}) {
  const effectiveMode = normalizeMode(mode, `applyNoSpawnFilter`);

  try {
    const addon = loadAddon();
    addon.applyNoSpawnFilter();
    return Object.freeze({
      applied: true,
      mode: effectiveMode,
      processLabel
    });
  } catch (error) {
    if (effectiveMode === `warn`) {
      logger.warn(`[SECCOMP WARNING] Process ${processLabel} is continuing without fork/exec seccomp protection.`);
      logger.warn(error);
      return Object.freeze({
        applied: false,
        warned: true,
        mode: effectiveMode,
        processLabel,
        error
      });
    }

    const wrapped = new Error(
      `Process ${processLabel} requires seccomp fork/exec isolation, but it could not be applied: ${error.message}`
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function applyConfiguredNoSpawnFilter({
  env = process.env,
  processLabel = process.env.PROCESS_LABEL ?? process.title ?? `unknown`,
  securityConfigPath = SECURITY_CONFIG_PATH,
  logger = console,
  loadAddon = loadNativeSeccompAddon
} = {}) {
  const mode = resolveSeccompMode({ env, securityConfigPath });
  return applyNoSpawnFilter({
    mode,
    processLabel,
    logger,
    loadAddon
  });
}

function dropAllCapabilities({
  loadAddon = loadNativeSeccompAddon
} = {}) {
  const addon = loadAddon();
  if (typeof addon?.dropAllCapabilities !== `function`) {
    throw new Error(`Native seccomp addon does not expose dropAllCapabilities()`);
  }

  addon.dropAllCapabilities();
  return Object.freeze({
    applied: true
  });
}

module.exports = {
  applyConfiguredNoSpawnFilter,
  applyNoSpawnFilter,
  dropAllCapabilities,
  loadNativeSeccompAddon,
  resolveSeccompMode
};

Object.freeze(module.exports);
