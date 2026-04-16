# Scoped CLI Operations

This experience makes operational control feel like a single packaged CLI while still respecting runtime scope, identity, and responsibility boundaries.

## Experience

- Operators start from one `ehecoatl` entrypoint instead of stitching together ad hoc shell commands.
- Scope determines which actions are valid at the core, tenant, or app surface.
- The command surface stays scriptable because the packaged CLI is shell-based and installed with the runtime.

## Implementation

- The packaged entrypoint dispatches subcommands from a single shell surface.
- Core service operations and deploy flows are implemented as standalone command scripts.
- Scope separation is aligned with runtime identities and contract-defined topology.

## Key Files

- [`ehecoatl-runtime/cli/ehecoatl.sh`](../../ehecoatl-runtime/cli/ehecoatl.sh)
- [`ehecoatl-runtime/cli/commands/core/start.sh`](../../ehecoatl-runtime/cli/commands/core/start.sh)
- [`ehecoatl-runtime/cli/commands/shared/deploy.sh`](../../ehecoatl-runtime/cli/commands/shared/deploy.sh)
- [`ehecoatl-runtime/contracts/layers/supervision-scope.contract.js`](../../ehecoatl-runtime/contracts/layers/supervision-scope.contract.js)

## Related Docs

- [CLI](../reference/cli.md)
- [Host Lifecycle Management](host-lifecycle-management.md)
- [Tenant and App Deployment Flow](tenant-and-app-deployment-flow.md)
