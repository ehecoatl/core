# Request Security Composition

This experience gives the runtime a composable request-security surface through middleware and route metadata, while keeping the highest-level policies explicit about where they are runtime-wide and where they are example-driven.

## Experience

- Session, auth, CSRF, CORS, and `authScope` can be expressed through the packaged middleware and route surface.
- Tenant-shared and app-local policies can be composed without bypassing the runtime stack.
- The current repository demonstrates the richer policy surface primarily through packaged middleware plus the default app embedded in the tenant kit.

## Implementation

- Route metadata carries policy inputs such as CORS and auth scope.
- Middleware stack resolution and execution apply the effective request-security behavior.
- The example tenant kit and its embedded default app show a concrete session/auth/CSRF/CORS flow on top of those runtime primitives.

## Key Files

- `ehecoatl-runtime/_core/runtimes/middleware-stack-runtime/middleware-stack-runtime.js`
- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/shared/app/http/middlewares/session.js`
- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/shared/app/http/middlewares/auth.js`
- `ehecoatl-runtime/builtin-extensions/tenant-kits/test/app_www/app/http/actions/auth-login.js`

## Related Docs

- [Middleware and Route Policy Composition](middleware-and-route-policy-composition.md)
- [Tenant Kits](tenant-kits.md)
- [Request Lifecycle](../../core-concepts/request-lifecycle.md)
