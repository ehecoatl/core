# App Kits

This experience gives application teams a packaged starting point for routes, actions, assets, and demo behavior that already fits the runtime model.

## Experience

- App kits let teams deploy something useful without designing the entire app layout from zero.
- Example HTTP and WS behaviors demonstrate how routes and actions should be organized.
- App kits stay aligned with the tenant and deployment model instead of bypassing the packaged topology.

## Implementation

- App kits provide app-local config, routes, actions, and assets that can be deployed into an existing tenant.
- App kits may be stored as folders or `.zip` archives. Zip app kits must place app files directly at the zip root.
- App kit resolution checks built-in kits, then `PATHS.EXTENSIONS.customAppKits`, then `https://github.com/ehecoatl/app-kit-<kitname>.git`.
- Remote fallback kits are cloned into the custom app-kit root as `<kitname>/` and are not auto-updated on later deploys.
- HTTP and WS actions execute inside the isolated runtime model rather than in the ingress process.
- The example app kit exercises the same middleware, auth, and WS action surfaces described elsewhere in the docs.

## Key Files

- `ehecoatl-runtime/builtin-extensions/app-kits/test/config/default.json`
- `ehecoatl-runtime/builtin-extensions/app-kits/test/app/http/actions/auth-login.js`
- `ehecoatl-runtime/builtin-extensions/app-kits/test/app/ws/actions/hello.js`
- `ehecoatl-runtime/builtin-extensions/app-kits/test/routes/ws/base.json`

## Related Docs

- [Tenant and App Kits](tenant-and-app-kits.md)
- [WS Action Dispatch](ws-action-dispatch.md)
- [Middleware and Route Policy Composition](middleware-and-route-policy-composition.md)
