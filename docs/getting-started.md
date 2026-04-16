# Getting Started

This page focuses on the current Ehecatl runtime as implemented in the repository root.

## Requirements

The supported packaged flow assumes:

- a Linux host with `systemd` available through `systemctl`,
- `sudo` access for installation and service setup, and
- `Node.js 24` with `npm` available or provisioned by bootstrap.

`setup/bootstrap-system.sh` provisions `Node.js 24` when needed, validates `systemd`, and places the project under `/opt/ehecatl`. Redis is not part of the default bootstrap path. If you want a local Redis installation managed by Ehecatl, run `setup/bootstrap-redis.sh` after app setup has completed.

## Recommended Install Flow

Ehecatl ships a packaged install flow with an optional local Redis step.

### 1. Bootstrap a host and place the project under `/opt/ehecatl`

Use this on a fresh machine or whenever you want the packaged install path:

```bash
chmod +x setup/bootstrap-system.sh
./setup/bootstrap-system.sh
```

The bootstrap script:

1. detects whether it is already running from a local checkout,
2. installs `git` when a repository clone is required,
3. installs `Node.js 24` with `npm` when missing,
4. validates `systemd` tooling,
5. either synchronizes the current checkout into `/opt/ehecatl` or clones the repository there, and
6. prepares the setup scripts for execution.

After bootstrap finishes, run:

```bash
/opt/ehecatl/setup/setup-ehecatl.sh
```

### 2. Run app setup from the packaged install location

`setup/setup-ehecatl.sh` must be run from `/opt/ehecatl`. It does not relocate the project automatically.

```bash
chmod +x /opt/ehecatl/setup/setup-ehecatl.sh
/opt/ehecatl/setup/setup-ehecatl.sh
```

Setup will:

- load the runtime policy,
- install missing non-Node system dependencies,
- verify `Node.js 24`,
- run `npm install`,
- create runtime users and directories,
- publish the `ehecatl` CLI from `setup/cli/ehecatl.sh`,
- create missing split JSON config files under `/etc/opt/ehecatl/config`,
- install and enable `ehecatl.service`, and
- write installation metadata under `/etc/opt/ehecatl`.

If setup detects an existing installation, it exits cleanly without changes. Use `/opt/ehecatl/setup/setup-ehecatl.sh --force` to reapply setup intentionally.

### 3. Optional local Redis

If you want Ehecatl to manage a local Redis installation, run:

```bash
/opt/ehecatl/setup/bootstrap-redis.sh
```

Redis is optional and separate from the default install path. Existing external Redis deployments can also be used. When Redis bootstrap runs, it updates `/etc/opt/ehecatl/config/sharedCacheService.json` so the cache adapter points to Redis while keeping other JSON properties intact.

## Start and Stop the Runtime

After setup, use the packaged CLI commands:

```bash
ehecatl start
ehecatl status
ehecatl log
```

Other available runtime controls include `ehecatl stop` and `ehecatl restart`.

## Create a First Tenant

Ehecatl does not serve useful application traffic until a tenant exists under the configured tenants path. Create one with:

```bash
ehecatl tenant_create example.com -host www
```

## Uninstall and Purge

To remove the packaged application install while keeping persisted data:

```bash
/opt/ehecatl/setup/uninstall-ehecatl.sh
```

To remove persisted runtime data as well:

```bash
/opt/ehecatl/setup/purge-ehecatl-data.sh
```

If you previously installed local Redis through Ehecatl-managed scripts, use `/opt/ehecatl/setup/uninstall-redis.sh` separately.
