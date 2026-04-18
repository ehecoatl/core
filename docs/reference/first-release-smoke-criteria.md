# First Release Smoke Criteria

This checklist describes the minimum packaged-runtime verification expected before a release is treated as installable.

## Preconditions

Confirm that:

- the source checkout is available locally or through `ehecoatl-core.sh --download <release>`
- `systemd` is available
- `/opt/ehecoatl` can be managed by the setup scripts

## Setup Validation

Run:

```bash
./setup/install.sh --dry-run
./setup/install.sh
```

Confirm that setup:

- publishes `/usr/local/bin/ehecoatl`
- writes install metadata
- writes the internal install registry record
- creates `ehecoatl:ehecoatl`
- creates `g_superScope`
- creates `g_directorScope`
- creates `u_supervisor` as `nologin`
- enables `ehecoatl.service`

## Runtime Control Validation

Verify:

```bash
ehecoatl core start
ehecoatl core status
ehecoatl core log
ehecoatl core stop
```

## Deployment Validation

Verify a tenant and app deploy path:

```bash
ehecoatl core deploy tenant @example.com -t empty-tenant-kit
cd /var/opt/ehecoatl/tenants/tenant_<tenant_id>
ehecoatl tenant deploy app www -a empty-app-kit
```

Confirm that the deploy path completes and triggers the direct `director` tenant rescan successfully.
