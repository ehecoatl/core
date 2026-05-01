# Runtime State and Support Folders

This experience keeps runtime support data organized in dedicated state surfaces so app code and deploy-facing content are not mixed with logs, cache, spools, or backups.

## Experience

- Tenant-local runtime state lives under `.ehecoatl/` instead of polluting the app root.
- Shared runtime state also lives under explicit `/etc`, `/var`, and `/srv` roots derived from contracts.
- State surfaces are addressable enough to support ownership, cleanup, and future lifecycle tooling even when some of those tools are still missing.

## Implementation

- Tenancy reserves `.ehecoatl/` as the tenant-local system area for support folders.
- Runtime policy and setup derive broader host state roots and ACL behavior.
- Cleanup scripts treat packaged runtime removal and persistent state removal as separate flows.

## Key Files

- [`docs/core-concepts/tenancy.md`](../../core-concepts/tenancy.md)
- [`docs/reference/runtime-policy.md`](../../reference/runtime-policy.md)
- `setup/uninstall.sh`
- `setup/uninstall/purge-data.sh`

## Related Docs

- [Contracts-Driven Topology](contracts-driven-topology.md)
- [Host Lifecycle Management](../surface/host-lifecycle-management.md)
- [Retention and Cleanup Policy](../future/retention-and-cleanup-policy.md)
