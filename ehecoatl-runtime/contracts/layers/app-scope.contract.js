// ehecoatl-runtime/contracts/layers/app-scope.contract.js


'use strict';


const { service, serviceInstallRoot, appRoot, group, user } = require(`../context.js`);
const cliSpecApp = require(`../cli-specs/cli.spec.app.js`);

module.exports = {
  ABOUT: {
    label: `App Scope Layer Contract`,
    description: `Per-app scope runtime execution directives`,
    contractClass: `SERVICE.LAYER`,
  },
  CLI: {
    path: `${serviceInstallRoot}/cli`,
    SPECS: [cliSpecApp],
  },
  PATH_DEFAULTS: { path: null, owner: user.appUser, group: group.appScope, mode: `2775`, recursive: true },
  PATHS: {
    LOGS: {
      boot: [`${appRoot}/.ehecoatl/log/boot`],
      error: [`${appRoot}/.ehecoatl/log/error`],
      debug: [`${appRoot}/.ehecoatl/log/debug`, null, null, `2777`],
      report: [`${appRoot}/.ehecoatl/log/debug/report.json`, null, null, `0665`, false, `file`],
    },
    RUNTIME: {
      root: [`${appRoot}`],
      storage: [`${appRoot}/storage/`],
      logs: [`${appRoot}/storage/logs`],
      backups: [`${appRoot}/storage/backups`],
      uploads: [`${appRoot}/storage/uploads`, null, null, `2777`],
      cache: [`${appRoot}/storage/cache`],

      internal: [`${appRoot}/storage/.${service}`],
      internalArtifacts: [`${appRoot}/storage/.${service}/artifacts`],
      internalTmp: [`${appRoot}/storage/.${service}/tmp`],
    },
    OVERRIDES: {
      config: [`${appRoot}/config`, null, null, `2755`, true],
      routes: [`${appRoot}/routes`, null, null, `2755`, true],
      plugins: [`${appRoot}/plugins`],
    },
    RESOURCES: {
      app: [`${appRoot}/app`],
      utils: [`${appRoot}/app/utils`],
      scripts: [`${appRoot}/app/scripts`],
      httpMiddlewares: [`${appRoot}/app/http/middlewares`],
      wsMiddlewares: [`${appRoot}/app/ws/middlewares`],
      assets: [`${appRoot}/assets`],
      assetStatic: [`${appRoot}/assets/static`, null, null, `2775`],
    }
  },
  ACTORS: {
    SHELL: {
      identity: {
        user: user.appUser,
        group: group.appScope
      },
      umask: "027",
      login: {
        shell: `/usr/sbin/nologin`,
        home: appRoot
      },
      cli: {
        paths: [`${serviceInstallRoot}/cli`]
      }
    },
    PROCESSES: {
      isolatedRuntime: {
        description: `Per-tenant isolated runtime process`,
        identity: {
          key: `isolatedRuntime`,
          label: `e_app_{tenant_id}_{app_id}`,
          user: user.appUser,
          group: group.tenantScope,
          secondGroup: group.superScope,
          thirdGroup: group.internalScope
        },
        bootstrap: {
          entry: `${serviceInstallRoot}/bootstrap/process-isolated-runtime`,
          useCasesRequired: [
            `pluginRuntime`, //NEW
            `storageService`,
            `appFluentFsRuntime`,
            `sharedCacheService`,
            `rpcEndpoint`,
            `appRpcRuntime`,
            `wsAppRuntime`
          ]
        }
      }
    }
  },
  ACCESS: {
  }
};
