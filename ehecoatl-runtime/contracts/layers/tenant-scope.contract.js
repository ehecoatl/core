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
  PATH_DEFAULTS: { path: null, owner: user.tenantUser, group: group.tenantScope, mode: `2770`, recursive: true, type: `directory` },
  PATHS: {
    LOGS: {
      root: [`${tenantRoot}/.${service}/log`],
      error: [`${tenantRoot}/.${service}/log/error`],
      boot: [`${tenantRoot}/.${service}/log/boot`]
    },
    RUNTIME: {
      config: [`${tenantRoot}/config.json`, null, null, `2755`, true, `file`],
      root: [`${tenantRoot}/.${service}`, null, null, `2775`],
      lib: [`${tenantRoot}/.${service}/lib`, null, null, `2775`],
      cache: [`${tenantRoot}/.${service}/.cache`, null, null, `2775`],
      ssl: [`${tenantRoot}/.${service}/ssl`, null, null, `2775`],
      backups: [`${tenantRoot}/.${service}/backups`, null, null, `2775`]
    },
    OVERRIDES: {
      config: [`${tenantRoot}/shared/config`, null, null, `2755`, true],
      routes: [`${tenantRoot}/shared/routes`, null, null, `2755`, true],
      plugins: [`${tenantRoot}/shared/plugins`],
    },
    SHARED: {
      root: [`${tenantRoot}/shared/`],
      app: [`${tenantRoot}/shared/app`],
      utils: [`${tenantRoot}/shared/app/utils`],
      scripts: [`${tenantRoot}/shared/app/scripts`],
      httpActions: [`${tenantRoot}/shared/app/http/actions`],
      wsActions: [`${tenantRoot}/shared/app/ws/actions`],
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
          entry: `${serviceInstallRoot}/bootstrap/process-transport`,
          useCasesRequired: [
            `pluginRuntime`, //NEW
            `storageService`,
            `sharedCacheService`,
            `i18nCompiler`,
            `eRendererRuntime`,
            `rpcEndpoint`,
            `middlewareStackResolver`,
            `middlewareStackRuntime`,
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
