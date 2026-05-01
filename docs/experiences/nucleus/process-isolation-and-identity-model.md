# Process Isolation and Identity Model

This experience isolates runtime processes through explicit users, groups, privilege transitions, and post-bootstrap access reduction.

## Experience

- Each runtime process runs with an identity matched to its responsibility surface.
- Bootstrap-only access can be removed after startup so long-running processes keep less privilege.
- Group naming and topology stay contract-driven instead of being encoded ad hoc in scripts.

## Implementation

- Runtime bootstrap applies the process identity inside the process rather than relying only on the service manager.
- Transport and isolated runtime finalize isolation after bootstrap by dropping supplementary scope access.
- Layer contracts define the scope groups and their intended role in the runtime model.

## Key Files

- `ehecoatl-runtime/utils/process/apply-process-identity.js`
- `ehecoatl-runtime/utils/process/finalize-runtime-isolation.js`
- `ehecoatl-runtime/contracts/layers/supervision-scope.contract.js`
- `ehecoatl-runtime/contracts/layers/internal-scope.contract.js`

## Related Docs

- [Runtime Isolation After Bootstrap](runtime-isolation-after-bootstrap.md)
- [Contracts-Driven Topology](contracts-driven-topology.md)
- [Architecture](../../core-concepts/architecture.md)
