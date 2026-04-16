# First Release Smoke Criteria

Use this page as a practical smoke checklist for the packaged install flow.

## Preconditions

Before starting, confirm that:

- the repository is available locally,
- `systemd` is present,
- the packaged install path `/opt/ehecatl` is writable through the setup scripts,
- a scaffold tenant exists, either from `setup/setup-ehecatl.sh` or `ehecatl tenant_create <domain> -host www`, and
- any optional Redis expectation is explicit before running Redis-specific checks.

## Bootstrap

Run:

```bash
./setup/bootstrap-system.sh --dry-run
./setup/bootstrap-system.sh
```

Confirm that bootstrap reports a clean path toward `/opt/ehecatl` and leaves Redis for the optional separate step.

## Setup

Run:

```bash
/opt/ehecatl/setup/setup-ehecatl.sh --dry-run
/opt/ehecatl/setup/setup-ehecatl.sh
```

Confirm that setup:

- publishes `/usr/local/bin/ehecatl`,
- creates runtime directories,
- writes split JSON config files under `/etc/opt/ehecatl/config`, and
- enables `ehecatl.service`.

## Runtime Controls

Verify:

```bash
ehecatl start
ehecatl status
ehecatl log
```

Then confirm the runtime can also be stopped cleanly:

```bash
ehecatl stop
```

## Optional Redis

If local Redis should be installer-managed, run:

```bash
/opt/ehecatl/setup/bootstrap-redis.sh
```

Confirm that:

- a compatible local Redis service is enabled,
- `/etc/opt/ehecatl/config/sharedCacheService.json` contains `"adapter": "redis"`, and
- install metadata reflects Redis ownership state.
