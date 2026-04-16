// ehecoatl-runtime/contracts/layers/tenant-scope.contract.js


'use strict';


const { service, serviceInstallRoot, tenantRoot, user, group } = require(`../context.js`);
const cliSpecTenant = require(`../cli-specs/cli.spec.tenant.js`);

module.exports = {
  ABOUT: {
    label: `Tenant Scope Layer Contract`,
    description: `Tenant-level scope, shared routing overrides, and transport directives`,
    contractClass: `SERVICE.LAYER`,
  },
  CLI: {
    path: `${serviceInstallRoot}/cli`,
    SPECS: [cliSpecTenant],
  },
  PATH_DEFAULTS: { path: null, owner: user.tenantUser, group: group.tenantScope, mode: `2770`, recursive: true },
  PATHS: {
    LOGS: {
      root: [`${tenantRoot}/.${service}/logs`],
      error: [`${tenantRoot}/.${service}/logs/error`],
      boot: [`${tenantRoot}/.${service}/logs/boot`]
    },
    RUNTIME: {
      root: [`${tenantRoot}/.${service}`],
      lib: [`${tenantRoot}/.${service}/lib`],
      ssl: [`${tenantRoot}/.${service}/ssl`, null, null, `2775`],
      backups: [`${tenantRoot}/.${service}/backups`]
    },
    OVERRIDES: {
      config: [`${tenantRoot}/shared/config`],
      routes: [`${tenantRoot}/shared/routes`],
      plugins: [`${tenantRoot}/shared/plugins`],
    },
    SHARED: {
      root: [`${tenantRoot}/shared/`],
      app: [`${tenantRoot}/shared/app`],
      assets: [`${tenantRoot}/shared/assets`],
      assetStatic: [`${tenantRoot}/shared/assets/static`, null, null, `2775`],
      httpMiddlewares: [`${tenantRoot}/shared/app/http/middlewares`],
      wsMiddlewares: [`${tenantRoot}/shared/app/ws/middlewares`],
    }
  },
  ACTORS: {
    SHELL: {
      identity: {
        user: user.tenantUser,
        group: group.tenantScope
      },
      umask: "027",
      login: {
        shell: `/usr/sbin/nologin`,
        home: tenantRoot
      },
      cli: {
        paths: [`${serviceInstallRoot}/cli`]
      }
    },
    PROCESSES: {
      transport: {
        description: `Ingress transport and socket-facing process, one per tenant`,
        identity: {
          key: `transport`,
          label: `e_transport_{tenant_id}`,
          user: user.tenantUser,
          group: group.tenantScope,
          secondGroup: group.superScope,
          thirdGroup: group.internalScope
        },
        bootstrap: {
          entry: `${serviceInstallRoot}/bootstrap/bootstrap-transport`,
          useCasesRequired: [
            `pluginRuntime`, //NEW
            `storageService`,
            `sharedCacheService`,
            `rpcEndpoint`,
            `middlewareStackResolver`,
            `middlewareStackOrchestrator`,
            `ingressRuntime`,
            `middlewarePipelineRuntime`, //NEW
          ]
        }
      }
    }
  },
  ACCESS: {
  }
};
