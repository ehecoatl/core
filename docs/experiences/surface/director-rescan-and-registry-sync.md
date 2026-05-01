# Director Rescan and Registry Sync

This experience provides an explicit way to force director reconciliation when tenancy state changes and operators need the live registry refreshed immediately.

## Experience

- A tenant deploy can trigger a rescan as part of its normal operational path.
- Operators can call the same rescan capability directly when they need a manual sync point.
- Reconciliation is deduplicated so repeated rescan requests collapse into a single follow-up pass when work is already running.

## Implementation

- The director exposes a direct local RPC ingress over a Unix socket.
- The CLI sends the rescan request directly to the director process instead of routing through `main`.
- Director serializes scan work and coalesces forced rescans when a current reconciliation cycle is active.

## Key Files

- `ehecoatl-runtime/bootstrap/director-cli-socket.js`
- `ehecoatl-runtime/bootstrap/process-director.js`
- `ehecoatl-runtime/cli/commands/core/rescan_tenants.sh`
- `ehecoatl-runtime/builtin-extensions/adapters/inbound/tenant-directory-resolver/default-tenancy.js`

## Related Docs

- [Registry Scan and Reconciliation](registry-scan-and-reconciliation.md)
- [RPC and Runtime Topology](../nucleus/rpc-and-runtime-topology.md)
- [Tenant and App Deployment Flow](tenant-and-app-deployment-flow.md)
