# Core Service Lifecycle

This experience packages the service lifecycle so operators can install, start, inspect, restart, stop, uninstall, and purge through stable product flows.

## Experience

- The host lifecycle begins with installation and setup instead of manual path assembly.
- Service state is controlled through packaged commands that map cleanly to the service manager.
- Removal is split between uninstall and purge so runtime removal and data destruction remain separate decisions.

## Implementation

- Bootstrap publishes the packaged runtime, config, and service unit into their host locations.
- Core lifecycle commands wrap service-manager operations through the packaged CLI.
- Uninstall and purge target different parts of the host footprint to preserve or destroy state intentionally.

## Key Files

- `setup/bootstrap.sh`
- `ehecoatl-runtime/cli/commands/core/start.sh`
- `ehecoatl-runtime/cli/commands/core/status.sh`
- `setup/uninstall.sh`
- `setup/uninstall/purge-data.sh`

## Related Docs

- [Host Lifecycle Management](host-lifecycle-management.md)
- [Setup and Maintenance](../../reference/setup-and-maintenance.md)
- [Operational Observability](operational-observability.md)
