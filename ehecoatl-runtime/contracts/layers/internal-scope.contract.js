// ehecoatl-runtime/contracts/layers/internal-scope.contract.js


'use strict';


const {
  serviceInstallRoot,
  builtinExtensionsRoot,
  serviceVarRoot,
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
      builtinExtensions: [`${builtinExtensionsRoot}`, null, null, `0775`],
      builtinMiddlewares: [`${builtinExtensionsRoot}/middlewares`, null, null, `0555`],
      builtinHttpMiddlewares: [`${builtinExtensionsRoot}/middlewares/http`, null, null, `0555`],
      builtinWsMiddlewares: [`${builtinExtensionsRoot}/middlewares/ws`, null, null, `0555`],
      welcomePage: [`${serviceInstallRoot}/welcome-ehecoatl.htm`, null, null, `0555`, false, `file`],
    },
    RUNTIME: {
      var: [`${serviceVarRoot}`, null, null, `0711`, false],
      cache: [`${serviceVarRoot}/cache`, null, null, `0750`],
      spool: [`${serviceVarRoot}/spool`, null, null, `0750`],
      backups: [`${serviceVarRoot}/backups`, null, null, `0750`],
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
