# Snapshot Contracts

This folder documents the persisted `config.json` snapshots mirrored into the runtime registry.

These contracts describe the registry-facing shape for:

- tenant snapshots
- app snapshots

## Role

- layer contracts describe the runtime topology and process identities
- snapshot contracts describe the persisted mirror written under `supervisionScope.PATHS.RUNTIME.registry`

## Shared Variables Present In Both Snapshot Entities

Both tenant and app registry snapshots currently include:

- `installId`
- `ehecoatlVersion`
- `createdAt`
- `tenantId`
- `tenantDomain`
- `source.tenantsRoot`

These are the common minimum variables shared across both persisted entity snapshots.

Everything else is entity-specific:

- tenant snapshot adds tenant-level routing and app listing fields
- app snapshot adds app identity, routing, compiled routes, and app source folders

## Files

- `tenant.snapshot.contract.js`
  Contract for `registry/tenant_{tenant_id}/config.json`
- `app.snapshot.contract.js`
  Contract for `registry/tenant_{tenant_id}/app_{app_id}/config.json`
