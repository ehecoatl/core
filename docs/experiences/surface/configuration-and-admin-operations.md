# Configuration and Admin Operations

This experience exposes the runtime's administrative and configuration tasks through packaged commands instead of leaving them as ad hoc file edits and shell procedures.

## Experience

- Operators can inspect and update configuration through scoped CLI commands.
- Enable, disable, delete, list, and status flows exist across core, tenant, and app scopes.
- Administrative actions remain aligned with the same scope model used by deploy and lifecycle commands.

## Implementation

- Scope-specific command trees expose configuration and state-management operations.
- Grouped JSON configuration and runtime policy keep the operational surface structured instead of fully free-form.
- Administrative flows are separated by core, tenant, and app command namespaces.

## Key Files

- [`docs/reference/cli.md`](../../reference/cli.md)
- [`docs/reference/configuration.md`](../../reference/configuration.md)
- `ehecoatl-runtime/cli/commands/core/list.sh`
- `ehecoatl-runtime/cli/commands/tenant/config.sh`

## Related Docs

- [Scoped CLI Operations](scoped-cli-operations.md)
- [Human Access and Scoped Workspaces](human-access-and-scoped-workspaces.md)
- [Configuration](../../reference/configuration.md)
