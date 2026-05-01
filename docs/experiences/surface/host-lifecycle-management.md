# Host Lifecycle Management

This experience packages the host lifecycle so installation, bootstrap, uninstall, and purge behave like explicit product operations instead of bespoke admin work.

## Experience

- A local checkout or staged release can bootstrap the host into a known packaged runtime layout.
- Runtime removal and data removal are separated so operators can uninstall without immediately purging state.
- Maintenance remains predictable because setup scripts materialize paths, config, identities, and service integration together.

## Implementation

- Bootstrap orchestrates host preparation, package copy, systemd integration, and runtime setup.
- Setup materializes the derived topology, ownership, and permissions on host paths.
- Uninstall removes the packaged runtime and service integration, while purge removes persistent data and managed artifacts.

## Key Files

- `setup/bootstrap.sh`
- `setup/install.sh`
- `setup/uninstall.sh`
- `setup/uninstall/purge-data.sh`
- `ehecoatl-runtime/systemd/ehecoatl.service`

## Related Docs

- [Setup and Maintenance](../../reference/setup-and-maintenance.md)
- [Core Service Lifecycle](core-service-lifecycle.md)
- [Contracts-Driven Topology](../nucleus/contracts-driven-topology.md)
