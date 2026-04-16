'use strict';

require(`module-alias/register`);

const contractIdentity = require(`./contract-identity.js`);

const [command, ...args] = process.argv.slice(2);

function main() {
  switch (command) {
    case `tenant-filesystem`:
      return outputJson(contractIdentity.getRenderedTenantFilesystemIdentity(args[0]));
    case `app-filesystem`:
      return outputJson(contractIdentity.getRenderedAppFilesystemIdentity(args[0], args[1]));
    case `shell-identity`:
      return outputJson(contractIdentity.getRenderedScopeShellIdentity(args[0], {
        tenantId: args[1] ?? null,
        appId: args[2] ?? null,
        installId: args[3] ?? null
      }));
    case `process-identity`:
      return outputJson(contractIdentity.getRenderedScopeProcessIdentity(args[0], args[1], {
        tenantId: args[2] ?? null,
        appId: args[3] ?? null,
        installId: args[4] ?? null
      }));
    case `path-entry`:
      return outputJson(contractIdentity.getRenderedScopePathEntry(args[0], args[1], args[2], {
        tenantId: args[3] ?? null,
        appId: args[4] ?? null,
        installId: args[5] ?? null
      }));
    default:
      throw new Error(`Unknown contract-identity-cli command: ${command ?? `(missing)`}`);
  }
}

function outputJson(value) {
  process.stdout.write(JSON.stringify(value ?? null));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exit(1);
}
