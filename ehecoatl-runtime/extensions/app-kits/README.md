# App Kits

This folder is the home for built-in App Kits.

The current topology reference for App Kits comes from the App Scope Layer Contract in [app-scope.contract.js](../../contracts/layers/app-scope.contract.js).

## Contract Topology

At contract level, an app runtime is organized around these roots:

```text
<app_root>/
  .ehecoatl/
    log/
      error/
      debug/
      boot/

  storage/
    logs/
    backups/
    uploads/
    cache/
    .ehecoatl/
      artifacts/
      tmp/

  config/
  routes/
  app/
    utils/
    scripts/
  assets/
  plugins/
```

## Notes

- The contract currently declares the top-level runtime roots, not every nested convention inside a kit.
- A concrete App Kit may still provide deeper structure inside those roots, such as HTTP and WS folders under `app/` and transport-specific files under `routes/`.
- `config/` and `routes/` are modeled by the contract as override roots.
- `app/`, `assets/`, and `plugins/` are modeled by the contract as extension roots.
- `app/utils/` and `app/scripts/` are contract-declared app resource subtrees for reusable app-local code.
- `storage/` is the writable app runtime area.
- `.ehecoatl/log/` is the app-local runtime log area declared by contract.
- `index.js` and any topology helper exports are kit implementation details, not currently part of the contract-declared path set.

## Isolated Runtime Context

The isolated runtime exposes the same `services` object to:

- the app entrypoint `boot(context)` in `index.js`
- HTTP action handlers
- WS action handlers

The current service surface includes:

- `services.storage`
- `services.fluentFs`
- `services.cache`
- `services.rpc`
- `services.ws`

`services.fluentFs` is the preferred path resolver for app code. Example usage:

```js
services.fluentFs.app.http.actions.path(`hello.js`);
services.fluentFs.assets.static.htm.path(`index.htm`);
services.fluentFs.storage.uploads.path(`file.txt`);
```

Fallback policy:

- `app` resolves app-local first, then tenant shared `shared/app`
- `assets` resolves app-local first, then tenant shared `shared/assets`
- `storage` remains app-local only

Shared fallback targets currently include:

- `shared/app/http/actions`
- `shared/app/ws/actions`
- `shared/assets`
