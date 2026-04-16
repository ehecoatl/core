# Runtime Contracts

This folder is the readable source of truth for the packaged runtime.

## Current Model

`index.js` exports:

- `CLI`
- `SETUP`
- `PROCESS_DEFAULTS`
- `SNAPSHOTS`
- `LAYERS`
- `LAYER_ISOLATION_CHAIN`

The current layer chain is:

- `appScope`
- `tenantScope`
- `supervisionScope`
- `internalScope`

## Layer Intent

- `internalScope`
  Hidden service/runtime layer. Owns protected install paths, internal registry paths, and runtime-owned files.
- `supervisionScope`
  Service-level editable layer for config, extensions, and service supervision.
- `tenantScope`
  Tenant-shared editable layer.
- `appScope`
  One-app editable layer.

## Identity Intent

- `user.internalUser`
  Fixed runtime identity: `ehecoatl`
- `user.supervisorUser`
  Shared supervision scope user: `u_supervisor`
- `user.tenantUser`
  Auto-generated tenant scope user: `u_tenant_{tenant_id}`
- `user.appUser`
  Auto-generated app scope user: `u_app_{tenant_id}_{app_id}`

All runtime processes run as `user.internalUser`. Auto-generated scope users remain part of the lifecycle model but are `nologin`.

## CLI Intent

- `supervisionScope` links `cli.spec.core.js`
- `tenantScope` links `cli.spec.tenant.js`
- `appScope` links `cli.spec.app.js`
- `internalScope` links `cli.spec.firewall.js`

`cli.spec.shared.js` is reusable contract source material only.

## Derivers

- `derive-runtime-policy.js`
  Compatibility runtime policy derived from contracts.
- `derive-setup-topology.js`
  Minimal concrete setup filesystem topology derived from all current layers.
- `derive-setup-identities.js`
  Install identity derivation, including `install_id`, internal runtime identity, and auto-generated supervision scope identity.
