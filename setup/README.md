# Setup

`setup/` contains the host-side install, bootstrap, uninstall, and purge scripts for Ehecoatl.

The packaged runtime payload itself lives under `ehecoatl-runtime/`.

## Main Entry Points

- `bootstrap.sh`
  Prepares the host and installs the packaged runtime into `/opt/ehecoatl`.
- `install.sh`
  Installs runtime dependencies, identities, config files, and the systemd unit.
- `uninstall.sh`
  Removes the packaged runtime while preserving persisted data.
- `uninstall/purge-data.sh`
  Removes persisted Ehecoatl data after uninstall.

## Optional Bootstraps

Optional host-component provisioning lives under [bootstraps/](./bootstraps/README.md):

- Nginx
- Let's Encrypt client
- Redis

These scripts record ownership metadata so uninstall can distinguish installer-managed components from pre-existing host services.

## Shared Behavior

The install/bootstrap layer consumes contract-derived topology and runtime policy data from `ehecoatl-runtime/contracts/`. It does not maintain a separate structural model.

Primary scripts support:

- `--yes`
- `--non-interactive`
- `--dry-run`

`bootstrap.sh` also supports:

- `--auto-install`
- `--complete`

`uninstall.sh` also supports:

- `--purge`

## Key Operational Notes

- Install verifies that the native seccomp addon is built successfully on Linux.
- Install also materializes nested `node_modules` inside built-in extensions that declare their own `package.json`.
- The packaged service unit starts as `root`, and runtime identity switching happens inside the bootstrap path.
- Uninstall preserves data and host prerequisites.
- Purge removes runtime data roots and generated host artifacts, but does not remove Redis automatically.
