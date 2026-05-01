# Contracts-Driven Topology

This experience keeps runtime layout, identity, and permissions declarative by deriving host topology from contracts instead of hand-maintained setup logic.

## Experience

- Filesystem paths, ownership, and modes can be reasoned about from contracts.
- Setup stays aligned with runtime expectations because both are derived from the same contract material.
- Permission changes can be applied consistently, including recursive rules where the topology declares them.

## Implementation

- Layer contracts describe shared and scoped runtime paths, users, and groups.
- Setup derives a materialized topology from those contracts before applying it on the host.
- Recursive permission behavior is applied only when a topology entry declares `recursive: true`.

## Key Files

- `ehecoatl-runtime/contracts/derive-setup-topology.js`
- `ehecoatl-runtime/contracts/layers/internal-scope.contract.js`
- `ehecoatl-runtime/contracts/layers/supervision-scope.contract.js`
- `setup/install.sh`

## Related Docs

- [Repository Structure](../../reference/repository-structure.md)
- [Process Isolation and Identity Model](process-isolation-and-identity-model.md)
- [Host Lifecycle Management](../surface/host-lifecycle-management.md)
