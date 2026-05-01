# Tenant Kits

This experience gives a tenant-level packaging surface for shared middleware, shared assets, and tenant-wide conventions before any one app is deployed.

## Experience

- Tenant kits define the default behavior shared across apps inside one tenant.
- Shared middleware and configuration live at the tenant layer instead of being duplicated per app.
- Tenant kits make the first deploy useful by shipping opinionated starting behavior.

## Implementation

- Tenant kit content is copied into the tenant layout during deploy.
- Tenant kits may be stored as folders or `.zip` archives. Zip tenant kits must place tenant files directly at the zip root.
- Tenant kit resolution checks built-in kits, then `PATHS.EXTENSIONS.customTenantKits`, then `https://github.com/ehecoatl/tenant-kit-<kitname>.git`.
- Remote fallback kits are cloned into the custom tenant-kit root as `<kitname>/` and are not auto-updated on later deploys.
- Tenant kits may include top-level `app_<name>/` folders. Each matching folder is reserved as an embedded app source and is auto-deployed as app `<name>` during tenant deploy.
- Embedded app folders are copied into generated opaque app roots, then removed from the tenant root after successful app creation.
- Tenant-shared middleware becomes part of the runtime middleware resolution flow for deployed apps.
- The example tenant kit demonstrates tenant-level security and request policy composition.

## Key Files

- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/config.json`
- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/shared/app/http/middlewares/auth.js`
- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/shared/app/http/middlewares/cors.js`
- `ehecoatl-runtime/cli/commands/shared/deploy.sh`

## Related Docs

- [Tenant and App Kits](tenant-and-app-kits.md)
- [Middleware and Route Policy Composition](middleware-and-route-policy-composition.md)
- [Tenancy](../../core-concepts/tenancy.md)
