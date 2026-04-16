# Layer Contracts

Each `*.contract.js` file describes one runtime scope.

## Current Files

- `internal-scope.contract.js`
  Protected install/runtime layer, owned by `ehecoatl:ehecoatl`, with no login surface.
- `supervision-scope.contract.js`
  Service-level editable layer exposed through `g_superScope`.
- `tenant-scope.contract.js`
  Tenant-shared editable layer exposed through `g_{tenant_id}`.
- `app-scope.contract.js`
  App-local editable layer exposed through `g_{tenant_id}_{app_id}`.

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

## Current Shared/App Topology Notes

The latest contract-declared app and tenant shared subtrees include:

- app-local:
  - `app/`
  - `app/utils`
  - `app/scripts`
  - `assets/`
- tenant shared:
  - `shared/app/http/actions`
  - `shared/app/ws/actions`
  - `shared/app/http/middlewares`
  - `shared/app/ws/middlewares`
  - `shared/app/utils`
  - `shared/app/scripts`
  - `shared/assets`
  - `shared/assets/static`

These shared tenant roots are now first-class contract paths, not only kit conventions.
