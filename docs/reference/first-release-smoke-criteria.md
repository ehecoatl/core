# First Release Smoke Criteria

## Preconditions

Before starting, confirm:

- the source checkout is available locally or through `setup/downloader-ehecoatl.sh`,
- `systemd` is available,
- `/opt/ehecoatl` is writable through setup scripts,
- a tenant app scaffold can be created with:
  - `ehecoatl core deploy tenant @example.com -t empty-tenant`
  - `cd /var/opt/ehecoatl/tenants/tenant_<tenant_id>`
  - `ehecoatl tenant deploy app www -a empty-app`

## Setup

Run:

```bash
./setup/setup-ehecoatl.sh --dry-run
./setup/setup-ehecoatl.sh
```

Confirm that setup:

- publishes `/usr/local/bin/ehecoatl`,
- writes install metadata,
- writes an internal install registry record,
- creates `ehecoatl:ehecoatl`,
- creates `g_superScope`,
- creates `u_supervisor_{install_id}` as `nologin`,
- enables `ehecoatl.service`.

## Runtime Controls

Verify:

```bash
ehecoatl core start
ehecoatl core status
ehecoatl core log
ehecoatl core stop
```

## Login Management

Verify:

```bash
ehecoatl core generate login operator --scope super
ehecoatl core delete login operator --purge-home
```

Confirm that the generated login gets `/home/operator`, the expected scope groups, and a locked password when no `--password` is provided.
