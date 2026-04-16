# Setup and Maintenance

Ehecatl ships with shell scripts for installation, cleanup, local Redis bootstrapping, and runtime administration.

## `setup/bootstrap-system.sh`

This script prepares a host for a packaged Ehecatl installation. It:

1. detects whether it is running from a local checkout,
2. installs `git` when a repository clone is required,
3. installs `Node.js 24` with `npm` when missing,
4. validates `systemd` tooling,
5. synchronizes the current checkout into `/opt/ehecatl` or clones the repository there, and
6. prepares the setup scripts for execution.

It does not run app setup automatically, and it does not install Redis by default. After bootstrap, run `setup/setup-ehecatl.sh` from `/opt/ehecatl`.

## `setup/setup-ehecatl.sh`

This script configures the packaged application install under `/opt/ehecatl`. It:

- loads the runtime policy,
- installs required non-Node system dependencies,
- verifies `Node.js 24`,
- runs `npm install`,
- creates runtime users and directories,
- publishes the `ehecatl` CLI from `setup/cli/ehecatl.sh`,
- creates split JSON config files under `/etc/opt/ehecatl/config`,
- installs and enables `ehecatl.service`, and
- writes installation metadata.

When an existing installation is detected, `setup/setup-ehecatl.sh` exits cleanly without applying changes. Use `setup/setup-ehecatl.sh --force` to explicitly reapply setup and runtime service provisioning.

`setup/setup-ehecatl.sh` must be run from `/opt/ehecatl`; it does not relocate the project automatically.

## `setup/bootstrap-redis.sh`

This optional script installs or reuses a compatible local Redis 7.x service, enables it, updates `sharedCacheService.json` so the adapter becomes `redis`, and writes Redis ownership metadata for future uninstall behavior.

## `setup/uninstall-ehecatl.sh`

This script removes the packaged application install while preserving persisted data and leaving Redis untouched.

## `setup/uninstall-redis.sh`

This script removes Redis only when a local Redis install was previously managed by Ehecatl.

## `setup/purge-ehecatl-data.sh`

This script removes persisted Ehecatl data under the configured `/etc`, `/var`, and `/srv` policy paths.

## Runtime CLI

After setup, use the packaged CLI commands for runtime control instead of invoking package scripts manually:

- `ehecatl start`
- `ehecatl stop`
- `ehecatl restart`
- `ehecatl status`
- `ehecatl log`

The packaged dispatcher lives in the repository at `setup/cli/ehecatl.sh`, and the bundled command files live under `setup/cli/commands/*.sh`.

## Notes

- Use `bootstrap-redis.sh` when you want Ehecatl to manage a local Redis installation explicitly.
- Use `uninstall-redis.sh` only for Redis that was previously installed through Ehecatl-managed bootstrap.
- The installed symlink remains `/usr/local/bin/ehecatl`.
