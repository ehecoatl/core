# Runtime Isolation After Bootstrap

This experience reduces long-running privilege for `transport` and `isolatedRuntime` once startup has finished and bootstrap-only access is no longer needed.

## Experience

- Processes can start with the access needed to bootstrap and then settle into a narrower long-running identity surface.
- Supplementary scope groups exist only as long as startup requires them.
- Shared packaged code needed after the drop stays readable through explicit topology permissions instead of retained bootstrap privilege.

## Implementation

- Transport and isolated runtime clear `require.cache`, then finalize their runtime isolation state.
- Finalization drops supplementary scope access and sanitizes remaining capabilities.
- Contracts and setup grant shared packaged middleware read access so post-bootstrap lazy loads do not need `g_superScope` or internal-scope membership.

## Key Files

- `ehecoatl-runtime/utils/process/finalize-runtime-isolation.js`
- `ehecoatl-runtime/bootstrap/process-transport.js`
- `ehecoatl-runtime/bootstrap/process-isolated-runtime.js`
- `ehecoatl-runtime/contracts/layers/internal-scope.contract.js`

## Related Docs

- [Process Isolation and Identity Model](process-isolation-and-identity-model.md)
- [Require Cache Flush and Weak Loading](require-cache-flush-and-weak-loading.md)
- [Contracts-Driven Topology](contracts-driven-topology.md)
