# Tenant Kits

This folder is the home for built-in Tenant Kits.

The current topology reference for Tenant Kits comes from the Tenant Scope Layer Contract in [tenant-scope.contract.js](../../contracts/layers/tenant-scope.contract.js).

## Contract Topology

At contract level, a tenant ingress root is organized around these roots:

```text
<tenant_root>/
  .ehecoatl/
    logs/
      error/
      boot/
    ssl/
    lib/
    backups/

  shared/
    config/
    routes/
    plugins/
    app/
    assets/
```

## Notes

- The contract currently declares the shared tenant roots, not every nested convention inside `shared/`.
- `shared/config/`, `shared/routes/`, and `shared/plugins/` are modeled by the contract as override roots.
- `shared/app/` and `shared/assets/` are modeled by the contract as shared extension roots.
- The tenant kit may provide deeper structure inside `shared/app/` and `shared/assets/`, but that deeper structure is not yet fully declared in the contract.
- The tenant root `config.json` used by the current kit implementation is not declared as a contract path root yet.
- The default tenant kit now carries `.ehecoatl/lib/nginx.e.conf`, and the web-server service always renders nginx from the tenant-local copy of that template.
