# App Kits

This folder is the home for built-in App Kits.

The current topology reference for App Kits comes from the Tenant App Layer Contract in [tenant-app.contract.js](../../contracts/layers/tenant-app.contract.js).

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
  assets/
  plugins/
```

## Notes

- The contract currently declares the top-level runtime roots, not every nested convention inside a kit.
- A concrete App Kit may still provide deeper structure inside those roots, such as HTTP and WS folders under `app/` and transport-specific files under `routes/`.
- `config/` and `routes/` are modeled by the contract as override roots.
- `app/`, `assets/`, and `plugins/` are modeled by the contract as extension roots.
- `storage/` is the writable app runtime area.
- `.ehecoatl/log/` is the app-local runtime log area declared by contract.
- `index.js` and any topology helper exports are kit implementation details, not currently part of the contract-declared path set.
