# Registry Scan and Reconciliation

This experience keeps runtime state anchored to the filesystem and registry artifacts so tenancy can be rebuilt, refreshed, or repaired through explicit reconciliation.

## Experience

- Director can reconstruct runtime-facing tenancy state from the deployed tenant tree and registry metadata.
- Operators can force a rescan when deploy-time changes need immediate runtime visibility.
- Reconciliation favors declarative state on disk over opaque in-memory drift.

## Implementation

- The tenant directory resolver interprets tenant layout, aliases, and runtime registry data into live tenancy state.
- Director bootstraps the reconciliation pipeline and exposes a direct rescan surface.
- The CLI can trigger a forced rescan through the director socket instead of routing the request through another process.

## Key Files

- `ehecoatl-runtime/bootstrap/process-director.js`
- `ehecoatl-runtime/bootstrap/director-cli-socket.js`
- `ehecoatl-runtime/cli/commands/core/rescan_tenants.sh`
- `ehecoatl-runtime/builtin-extensions/adapters/inbound/tenant-directory-resolver/default-tenancy.js`

## Related Docs

- [Director Rescan and Registry Sync](director-rescan-and-registry-sync.md)
- [RPC and Runtime Topology](../nucleus/rpc-and-runtime-topology.md)
- [Tenancy](../../core-concepts/tenancy.md)
