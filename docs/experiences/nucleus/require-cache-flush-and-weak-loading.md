# Require Cache Flush and Weak Loading

This experience makes runtime-late code loading explicit by flushing bootstrap-loaded CommonJS state and then weak-loading the code that is allowed to load later.

## Experience

- Bootstrap-built object graphs can stay alive without leaving the entire module cache in place.
- Runtime-late code loading is narrowed to the places where it is expected, such as app entrypoints, actions, and middleware.
- Weak loading keeps late code paths deliberate and inspectable instead of relying on ambient cached state.

## Implementation

- Bootstraps clear `require.cache` after startup and clear tracked weak-require state alongside it.
- `isolatedRuntime` flushes before weak-loading the app entrypoint.
- Middleware and action loading continue through runtime-late weak-loading paths after the flush.

## Key Files

- `ehecoatl-runtime/utils/module/clear-require-cache.js`
- `ehecoatl-runtime/utils/module/weak-require.js`
- `ehecoatl-runtime/bootstrap/process-isolated-runtime.js`
- `ehecoatl-runtime/_core/resolvers/middleware-stack-resolver/middleware-stack-resolver.js`

## Related Docs

- [Runtime Isolation After Bootstrap](runtime-isolation-after-bootstrap.md)
- [Middleware and Route Policy Composition](../extension/middleware-and-route-policy-composition.md)
- [RPC and Runtime Topology](rpc-and-runtime-topology.md)
