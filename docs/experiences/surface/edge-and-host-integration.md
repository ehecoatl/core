# Edge and Host Integration

This experience lets Ehecoatl integrate with the local host edge stack through packaged bootstraps instead of assuming those services are configured manually elsewhere.

## Experience

- Operators can bootstrap or prepare local Nginx, Let's Encrypt, and Redis support through packaged scripts.
- Installer-managed ownership is recorded so uninstall removes only the components Ehecoatl actually introduced.
- Edge integration remains optional, which keeps the base runtime distinct from host-service management.

## Implementation

- Optional bootstraps prepare host services and write installer-managed metadata.
- Setup and uninstall flows consume that metadata so package removal remains safe on mixed-use hosts.
- Runtime policy and templates keep Nginx and related edge integration aligned with the packaged runtime model.

## Key Files

- `setup/bootstraps/README.md`
- `setup/bootstrap.sh`
- [`docs/reference/setup-and-maintenance.md`](../../reference/setup-and-maintenance.md)
- `ehecoatl-runtime/systemd/ehecoatl.service`

## Related Docs

- [Host Lifecycle Management](host-lifecycle-management.md)
- [Tenancy and Addressing Model](../nucleus/tenancy-and-addressing-model.md)
- [Setup and Maintenance](../../reference/setup-and-maintenance.md)
