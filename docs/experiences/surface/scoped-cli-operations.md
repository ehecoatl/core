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
- Human shell access is created with `ehecoatl core generate login "<username>" --scope "<selector>"`.
- Login scope selectors are intentionally limited to `super`, `"@<domain>"`, and `"@<tenant_id>"`.
- App-specific login generation is not exposed; tenant-scoped logins can reach app CLI work after changing into an app root inside the tenant workspace.

## Login Scope Selectors

`core generate login` requires at least one `--scope` flag, and the flag can be repeated:

```bash
ehecoatl core generate login "operator" --scope super
ehecoatl core generate login "editor" --scope "@example.test"
ehecoatl core generate login "admin" --scope super --scope "@example.test"
```

The supported selector formats are:

- `super`: grants supervision workspace access.
- `"@<domain>"`: resolves a tenant by domain, for example `"@example.test"`.
- `"@<tenant_id>"`: resolves a tenant by its opaque id.

## Key Files

- `ehecoatl-runtime/cli/ehecoatl.sh`
- `ehecoatl-runtime/cli/commands/core/start.sh`
- `ehecoatl-runtime/cli/commands/shared/deploy.sh`
- `ehecoatl-runtime/contracts/layers/supervision-scope.contract.js`

## Related Docs

- [CLI](../../reference/cli.md)
- [Host Lifecycle Management](host-lifecycle-management.md)
- [Tenant and App Deployment Flow](tenant-and-app-deployment-flow.md)
