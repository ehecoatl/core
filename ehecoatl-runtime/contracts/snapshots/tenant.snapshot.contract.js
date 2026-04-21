// ehecoatl-runtime/contracts/snapshots/tenant.snapshot.contract.js


'use strict';


module.exports = {
  ABOUT: {
    label: `Tenant Registry Snapshot Contract`,
    description: `Persisted config.json shape mirrored into the runtime registry for one tenant entity`,
    contractClass: `SERVICE.SNAPSHOT`,
  },
  ENTITY: {
    key: `tenant`,
    folderPattern: `tenant_{tenant_id}`,
    fileName: `config.json`
  },
  COMMON_FIELDS: {
    installId: {
      required: false,
      type: `string|null`,
      description: `Install id of the runtime instance where this tenant snapshot was first created`
    },
    ehecoatlVersion: {
      required: false,
      type: `string|null`,
      description: `Installed Ehecoatl version where this tenant snapshot was first created`
    },
    createdAt: {
      required: true,
      type: `string`,
      description: `UTC ISO timestamp recording when this tenant snapshot was first created`
    },
    tenantId: {
      required: true,
      type: `string`,
      description: `Opaque tenant id confirmed from tenant_{tenant_id}`
    },
    tenantDomain: {
      required: true,
      type: `string`,
      description: `Canonical tenant domain`
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
    appRouting: {
      required: false,
      type: `object|null`,
      description: `Normalized tenant app-routing config persisted for registry consumers`
    },
    certbotEmail: {
      required: false,
      type: `string|null`,
      description: `Tenant-preferred email for certbot issuance; falls back to adapter default when null`
    },
    appNames: {
      required: true,
      type: `string[]`,
      description: `Sorted active app names currently available inside the tenant`
    },
    aliases: {
      required: true,
      type: `string[]`,
      description: `Sorted domain aliases pointing to the tenant domain`
    },
    internalProxy: {
      required: true,
      type: `object`,
      description: `Persisted internal proxy port pair reserved for the tenant transport`,
      fields: {
        httpPort: {
          required: true,
          type: `number`,
          description: `Tenant-scoped internal HTTP proxy port`
        },
        wsPort: {
          required: true,
          type: `number`,
          description: `Tenant-scoped internal WebSocket proxy port`
        }
      }
    },
    certificateAutomation: {
      required: false,
      type: `object`,
      description: `Persisted certificate automation state used to deduplicate auto-issuance triggers`,
      fields: {
        letsEncryptTriggeredDomains: {
          required: false,
          type: `object`,
          description: `Per-domain trigger cooldown registry for asynchronous Let's Encrypt issuance`
        }
      }
    },
    source: {
      fields: {
        tenantFolder: {
          required: false,
          type: `string|null`,
          description: `Absolute source tenant folder path inside INTERNAL.tenants`
        }
      }
    }
  }
};

Object.freeze(module.exports);
