# Tenant Kits

This experience gives a tenant-level packaging surface for shared middleware, shared assets, and tenant-wide conventions before any one app is deployed.

## Experience

- Tenant kits define the default behavior shared across apps inside one tenant.
- Shared middleware and configuration live at the tenant layer instead of being duplicated per app.
- Tenant kits make the first deploy useful by shipping opinionated starting behavior.

## Implementation

- Tenant kit content is copied into the tenant layout during deploy.
- Tenant-shared middleware becomes part of the runtime middleware resolution flow for deployed apps.
- The example tenant kit demonstrates tenant-level security and request policy composition.

## Key Files

- [`ehecoatl-runtime/extensions/tenant-kits/test-tenant/config.json`](../../ehecoatl-runtime/extensions/tenant-kits/test-tenant/config.json)
- [`ehecoatl-runtime/extensions/tenant-kits/test-tenant/shared/app/http/middlewares/auth.js`](../../ehecoatl-runtime/extensions/tenant-kits/test-tenant/shared/app/http/middlewares/auth.js)
- [`ehecoatl-runtime/extensions/tenant-kits/test-tenant/shared/app/http/middlewares/cors.js`](../../ehecoatl-runtime/extensions/tenant-kits/test-tenant/shared/app/http/middlewares/cors.js)
- [`ehecoatl-runtime/cli/commands/shared/deploy.sh`](../../ehecoatl-runtime/cli/commands/shared/deploy.sh)

## Related Docs

- [Tenant and App Kits](tenant-and-app-kits.md)
- [Middleware and Route Policy Composition](middleware-and-route-policy-composition.md)
- [Tenancy](../core-concepts/tenancy.md)
