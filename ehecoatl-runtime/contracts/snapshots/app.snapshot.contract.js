// ehecoatl-runtime/contracts/snapshots/app.snapshot.contract.js


'use strict';


module.exports = {
  ABOUT: {
    label: `App Registry Snapshot Contract`,
    description: `Persisted app snapshot shape mirrored into the runtime registry for one isolated app entity`,
    contractClass: `SERVICE.SNAPSHOT`,
  },
  ENTITY: {
    key: `app`,
    folderPattern: `app_{app_id}`,
    fileName: `snapshot_{tenant_id}_{app_id}.json`
  },
  COMMON_FIELDS: {
    installId: {
      required: false,
      type: `string|null`,
      description: `Install id of the runtime instance where this app snapshot was first created`
    },
    ehecoatlVersion: {
      required: false,
      type: `string|null`,
      description: `Ehecoatl runtime version accepted by scanner for this app snapshot`
    },
    createdAt: {
      required: true,
      type: `string`,
      description: `UTC ISO timestamp recording when this app snapshot was first created`
    },
    tenantId: {
      required: true,
      type: `string`,
      description: `Opaque tenant id of the tenant that owns this app snapshot`
    },
    tenantDomain: {
      required: true,
      type: `string`,
      description: `Canonical tenant domain mirrored alongside the app snapshot`
    },
    source: {
      required: true,
      type: `object`,
      description: `Source metadata describing where this mirrored snapshot came from`,
      fields: {
        tenantsRoot: {
          required: true,
          type: `string`,
          description: `Service tenants root used as the source for registry mirroring`
        }
      }
    }
  },
  ENTITY_FIELDS: {
    appId: {
      required: true,
      type: `string`,
      description: `Opaque app id confirmed from app_{app_id}`
    },
    appName: {
      required: true,
      type: `string`,
      description: `Canonical app name configured for routing`
    },
    domain: {
      required: false,
      type: `string`,
      description: `Host routing domain currently persisted by the app registry snapshot`
    },
    methodsAvailable: {
      required: false,
      type: `string[]`,
      description: `Optional list of HTTP methods exposed by the app snapshot`
    },
    routesAvailable: {
      required: false,
      type: `object`,
      description: `Normalized routes map persisted for request-time resolution`
    },
    compiledRoutes: {
      required: false,
      type: `object[]`,
      description: `Compiled first-match route comparers persisted by the route matcher compiler`
    },
    source: {
      fields: {
        appFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source app folder path inside INTERNAL.tenants`
        },
        actionsRootFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source actions folder path`
        },
        assetsRootFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source assets folder path`
        },
        httpMiddlewaresRootFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source HTTP middlewares folder path`
        },
        wsMiddlewaresRootFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source WebSocket middlewares folder path`
        },
        routesRootFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source routes folder path`
        },
        appConfigMtimeMs: {
          required: false,
          type: `number|null`,
          description: `Last known app config mtime used to detect registry refresh`
        },
        tenantEntrypointMtimeMs: {
          required: false,
          type: `number|null`,
          description: `Last known app entrypoint mtime used to detect registry refresh`
        }
      }
    }
  }
};

Object.freeze(module.exports);
