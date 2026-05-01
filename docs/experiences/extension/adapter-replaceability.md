# Adapter Replaceability

This experience keeps infrastructure choices replaceable by expressing core behavior through ports and adapter-backed use cases instead of hard-wired implementations.

## Experience

- Core services and runtimes can change their underlying implementation without rewriting use-case logic.
- The same architecture can support built-in adapters and custom adapters through stable adapter paths.
- Runtime behavior remains testable because the port boundary is explicit.

## Implementation

- Core services, managers, resolvers, and runtimes extend adapter-backed use-case patterns.
- Adapter modules implement the infrastructure side of each port and are loaded through declared adapter paths.
- The runtime keeps these replaceable pieces behind core contracts and reference docs rather than scattering implementation choices across the codebase.

## Key Files

- [`docs/features/adapters.md`](../../features/adapters.md)
- `ehecoatl-runtime/_core/_ports/adaptable-use-case.js`
- `ehecoatl-runtime/_core/runtimes/process-fork-runtime/process-fork-runtime.js`
- `ehecoatl-runtime/builtin-extensions/adapters/inbound/tenant-directory-resolver/default-tenancy.js`

## Related Docs

- [Adapters](../../features/adapters.md)
- [RPC and Runtime Topology](../nucleus/rpc-and-runtime-topology.md)
- [Contracts-Driven Topology](../nucleus/contracts-driven-topology.md)
