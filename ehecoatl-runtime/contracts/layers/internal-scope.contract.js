// ehecoatl-runtime/contracts/layers/internal-scope.contract.js


'use strict';


const {
  serviceInstallRoot,
  serviceTenantsRoot,
  serviceVarRoot,
  serviceLibRoot,
  group,
  user
} = require(`../context.js`);
const cliSpecFirewall = require(`../cli-specs/cli.spec.firewall.js`);

module.exports = {
  ABOUT: {
    label: `Internal Scope Layer Contract`,
    description: `Packaged internal-scope paths, shell entrypoints, and supervision directives`,
    contractClass: `SERVICE.LAYER`,
  },
  CLI: {
    path: `${serviceInstallRoot}/cli`,
    SPECS: [
      cliSpecFirewall,
    ],
  },
  PATH_DEFAULTS: { path: null, owner: user.internalUser, group: group.internalScope, mode: `0750`, recursive: true, type: `directory` },
  PATHS: {
    INTERNAL: {
      installation: [`${serviceInstallRoot}`, null, null, `0551`],
      welcomePage: [`${serviceInstallRoot}/welcome-ehecoatl.htm`, null, null, `0555`, false, `file`],
      tenants: [`${serviceTenantsRoot}`, null, null, `0711`],
    },
    RUNTIME: {
      var: [`${serviceVarRoot}`, null, null, `0711`],
      cache: [`${serviceVarRoot}/cache`, null, null, `0750`],
      spool: [`${serviceVarRoot}/spool`, null, null, `0750`],
      backups: [`${serviceVarRoot}/backups`, null, null, `0750`],
      lib: [`${serviceLibRoot}`, null, null, `0750`],
      ssl: [`${serviceLibRoot}/ssl`, null, null, `0750`],
      registry: [`${serviceLibRoot}/registry`, null, null, `0750`],
      managedLogins: [`${serviceLibRoot}/registry/managed-logins`, null, null, `0750`]
    }
  },
  SYMLINKS: {
    core: [`/root/ehecoatl/.core`, `${serviceInstallRoot}`],
    etc: [`/root/ehecoatl/.etc`, `/etc/opt/ehecoatl`],
    var: [`/root/ehecoatl/.var`, `${serviceVarRoot}`],
    srv: [`/root/ehecoatl/.srv`, `/srv/opt/ehecoatl`]
  },
  ACTORS: {
    SHELL: {
      identity: {
        user: user.internalUser,
        group: group.internalScope
      },
      login: {
        shell: `/usr/sbin/nologin`,
        home: null
      },
    },
    PROCESSES: {
    }
  },
  ACCESS: {

  }
};
