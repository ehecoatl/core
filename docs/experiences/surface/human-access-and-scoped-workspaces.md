# Human Access and Scoped Workspaces

This experience gives humans a deliberate shell-access surface without making runtime service users into direct login identities.

## Experience

- Human operators get managed logins through the CLI instead of reusing internal runtime identities.
- Access can be scoped to the super surface or tenant surfaces through explicit selectors.
- The curated `~/ehecoatl` workspace exposes only the linked roots that the granted scopes allow; app-specific login generation is intentionally not exposed.

## Implementation

- Core CLI commands create and remove managed human logins and workspace links.
- Runtime service users such as `u_supervisor`, `u_tenant_*`, and `u_app_*` remain `nologin`.
- Setup and uninstall flows preserve and clean scoped workspace artifacts as part of the managed host experience.

## Scope Selectors

Managed logins are created with `ehecoatl core generate login "<username>" --scope "<selector>"`.

Supported selectors are:

- `super`: grants supervision workspace access.
- `"@<domain>"`: grants access to the tenant resolved by domain.
- `"@<tenant_id>"`: grants access to the tenant resolved by opaque id.

Multiple selectors can be stacked:

```bash
ehecoatl core generate login "admin" --scope super --scope "@example.test"
```

App-scoped selectors such as `"app:www@example.test"` are not supported for login generation.

## Key Files

- [`docs/reference/cli.md`](../../reference/cli.md)
- [`docs/getting-started.md`](../../getting-started.md)
- `ehecoatl-runtime/cli/commands/core/generate_login.sh`
- `ehecoatl-runtime/cli/commands/core/delete_login.sh`

## Related Docs

- [Scoped CLI Operations](scoped-cli-operations.md)
- [Configuration and Admin Operations](configuration-and-admin-operations.md)
- [Setup and Maintenance](../../reference/setup-and-maintenance.md)
