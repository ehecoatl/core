'use strict';

const path = require(`node:path`);

const contracts = require(`./index.js`);
const context = require(`./context.js`);
const tenantLayout = require(path.join(__dirname, `..`, `utils`, `tenancy`, `tenant-layout.js`));

function renderTemplate(value, variables = {}) {
  return String(value ?? ``).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const resolved = variables[key];
    return resolved === undefined || resolved === null ? `{${key}}` : String(resolved);
  });
}

function deriveSetupIdentities(installId = null) {
  const internalRuntime = contracts.SETUP?.IDENTITIES?.internalRuntime ?? {};
  const supervisorScopeUser = contracts.SETUP?.IDENTITIES?.supervisorScopeUser ?? {};
  const registryDir = contracts.LAYERS?.supervisionScope?.PATHS?.RUNTIME?.registry?.[0]
    ?? `${context.serviceLibRoot}/registry`;

  const variables = {
    install_id: installId
  };

  return Object.freeze({
    installId: installId ? tenantLayout.normalizeOpaqueId(installId) : null,
    registryDir,
    registryFile: path.join(registryDir, `install.json`),
    internal: Object.freeze({
      user: renderTemplate(internalRuntime.user, variables),
      group: renderTemplate(internalRuntime.group, variables),
      shell: internalRuntime?.login?.shell ?? `/usr/sbin/nologin`,
      home: internalRuntime?.login?.home ?? null
    }),
    supervisor: Object.freeze({
      user: renderTemplate(supervisorScopeUser.user, variables),
      group: renderTemplate(supervisorScopeUser.group, variables),
      shell: supervisorScopeUser?.login?.shell ?? `/usr/sbin/nologin`,
      home: contracts.LAYERS?.supervisionScope?.ACTORS?.SHELL?.login?.home ?? context.serviceSrvRoot
    })
  });
}

function getNestedValue(target, dottedPath) {
  return String(dottedPath ?? ``)
    .split(`.`)
    .reduce((current, key) => current?.[key], target);
}

if (require.main === module) {
  const [mode = `json`, dottedPath, installIdArg] = process.argv.slice(2);

  switch (mode) {
    case `json`:
      process.stdout.write(JSON.stringify(deriveSetupIdentities(dottedPath || null), null, 2) + `\n`);
      break;
    case `value`: {
      const value = getNestedValue(deriveSetupIdentities(installIdArg || null), dottedPath);
      if (value === undefined || value === null) process.exit(2);
      process.stdout.write(String(value));
      break;
    }
    case `generate-install-id`:
      process.stdout.write(tenantLayout.generateOpaqueId() + `\n`);
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}

module.exports = {
  deriveSetupIdentities
};

Object.freeze(module.exports);
