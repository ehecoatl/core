'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const { reconcileRegistryState } = require(`@/_core/resolvers/tenant-registry-resolver/reconcile-registry-state`);
const TenantRegistryResolver = require(`@/_core/resolvers/tenant-registry-resolver/tenant-registry-resolver`);

test(`tenant registry reconciliation preserves known pairs and reuses freed pairs`, () => {
  const registry = Object.freeze({
    hosts: new Map(),
    domains: new Map([
      [`example.com`, Object.freeze({
        tenantId: `aaaaaaaaaaaa`,
        domain: `example.com`,
        rootFolder: `/tmp/tenant_aaaaaaaaaaaa`
      })],
      [`second.test`, Object.freeze({
        tenantId: `bbbbbbbbbbbb`,
        domain: `second.test`,
        rootFolder: `/tmp/tenant_bbbbbbbbbbbb`
      })]
    ]),
    domainAliases: new Map([
      [`alias.test`, Object.freeze({ point: `example.com` })],
      [`mirror.second.test`, Object.freeze({ point: `second.test` })]
    ]),
    invalidHosts: Object.freeze([])
  });

  const persistedTenantsById = new Map([
    [`aaaaaaaaaaaa`, Object.freeze({
      tenantId: `aaaaaaaaaaaa`,
      internalProxy: Object.freeze({ httpPort: 14006, wsPort: 14007 })
    })],
    [`cccccccccccc`, Object.freeze({
      tenantId: `cccccccccccc`,
      internalProxy: Object.freeze({ httpPort: 14002, wsPort: 14003 })
    })]
  ]);

  const reconciledRegistry = reconcileRegistryState({
    registry,
    persistedTenantsById,
    portStart: 14002,
    portEnd: 14100
  });

  assert.deepEqual(
    reconciledRegistry.domains.get(`example.com`)?.internalProxy,
    { httpPort: 14006, wsPort: 14007 }
  );
  assert.deepEqual(
    reconciledRegistry.domains.get(`second.test`)?.internalProxy,
    { httpPort: 14002, wsPort: 14003 }
  );
  assert.deepEqual(
    reconciledRegistry.domains.get(`example.com`)?.aliases,
    [`alias.test`]
  );
  assert.deepEqual(
    reconciledRegistry.domains.get(`second.test`)?.aliases,
    [`mirror.second.test`]
  );
});

test(`tenant registry resolver publishes per-tenant transport process identity for firewall sync`, async () => {
  const tempRegistryDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-registry-`));

  try {
    const resolver = new TenantRegistryResolver({
      config: {
        _adapters: {
          tenantRegistryResolver: null
        },
        adapters: {
          tenantRegistryResolver: {
            internalProxyPortStart: 14002,
            internalProxyPortEnd: 14100
          }
        }
      },
      useCases: {
        storageService: null
      }
    });
    resolver.registryPath = tempRegistryDir;

    const { scanSummary } = await resolver.reconcileRegistry(Object.freeze({
      hosts: new Map(),
      domains: new Map([
        [`example.com`, Object.freeze({
          tenantId: `aaaaaaaaaaaa`,
          domain: `example.com`,
          rootFolder: `/tmp/tenant_aaaaaaaaaaaa`
        })]
      ]),
      domainAliases: new Map(),
      invalidHosts: Object.freeze([])
    }));

    assert.deepEqual(scanSummary.activeTenants, [
      {
        tenantId: `aaaaaaaaaaaa`,
        tenantDomain: `example.com`,
        tenantRoot: `/tmp/tenant_aaaaaaaaaaaa`,
        aliases: [],
        internalProxy: { httpPort: 14002, wsPort: 14003 },
        transportProcessUser: `u_tenant_aaaaaaaaaaaa`,
        transportProcessGroup: `g_aaaaaaaaaaaa`,
        transportProcessSecondGroup: `g_superScope`,
        transportProcessThirdGroup: `ehecoatl`
      }
    ]);
  } finally {
    fs.rmSync(tempRegistryDir, { recursive: true, force: true });
  }
});
