# Layer Contracts

Each `*.contract.js` file describes one runtime scope.

## Current Files

- `internal-scope.contract.js`
  Protected install/runtime layer, owned by `ehecoatl:ehecoatl`, with no login surface.
- `supervision-scope.contract.js`
  Service-level editable layer exposed through `g_superScope`.
- `tenant-scope.contract.js`
  Tenant-shared editable layer exposed through `g_tenantScope_{tenant_id}`.
- `app-scope.contract.js`
  App-local editable layer exposed through `g_appScope_{tenant_id}_{app_id}`.

## Important Shape

Layer contracts expose:

- `ABOUT`
- `CLI`
- `PATH_DEFAULTS`
- `PATHS`
- `SYMLINKS`
- `ACTORS`
- `ACCESS`

`PATHS` still use tuple entries:

```js
[path, owner?, group?, mode?, recursive?]
```

`SYMLINKS` use tuple entries:

```js
[linkPath, targetPath]
```

## Current Rules

- Runtime-owned files point to `user.internalUser`.
- Scope groups are the group owners for writable scope trees.
- Auto-generated scope shell identities are `nologin`.
- `derive-setup-topology.js` now reads all exported layers, not only supervision.
