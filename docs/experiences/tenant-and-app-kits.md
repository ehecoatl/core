# Tenant and App Kits

This experience gives developers packaged starting points for deploying tenants and apps without rebuilding the runtime surface from scratch.

## Experience

- Tenant kits establish shared tenant-level behavior before individual apps are deployed.
- App kits package routes, actions, assets, and example runtime behavior for quick rollout.
- Kits keep starter behavior aligned with the same deploy and reconciliation flows used in production topology.

## Implementation

- Deploy commands copy kit content into contract-backed runtime locations.
- The example tenant and app kits exercise middleware, HTTP, and WS behavior inside the packaged runtime model.
- Kit content is organized so tenant-level concerns stay distinct from app-local concerns.

## Key Files

- [`ehecoatl-runtime/extensions/tenant-kits/test-tenant/config.json`](../../ehecoatl-runtime/extensions/tenant-kits/test-tenant/config.json)
- [`ehecoatl-runtime/extensions/app-kits/test-app/config/default.json`](../../ehecoatl-runtime/extensions/app-kits/test-app/config/default.json)
- [`ehecoatl-runtime/cli/commands/shared/deploy.sh`](../../ehecoatl-runtime/cli/commands/shared/deploy.sh)

## Related Docs

- [Tenant Kits](tenant-kits.md)
- [App Kits](app-kits.md)
- [Tenant and App Deployment Flow](tenant-and-app-deployment-flow.md)
