# Repository Structure

This page describes the current repository layout.

## Top-Level Directories

- `app/`
  Runtime source code, config, tests, bootstrap helpers, and built-in plugins.
- `setup/`
  Bootstrap, app setup, Redis setup, uninstall, purge, support libraries, templates, the packaged CLI, and the systemd unit template.
- `docs/`
  Project documentation.

## Setup Scripts

The packaged setup area currently includes:

- `setup/bootstrap-system.sh`
- `setup/bootstrap-redis.sh`
- `setup/setup-ehecatl.sh`
- `setup/uninstall-ehecatl.sh`
- `setup/uninstall-redis.sh`
- `setup/purge-ehecatl-data.sh`
- `setup/lib/runtime-policy.sh`
- `setup/systemd/ehecatl.service`
- `setup/README.md`

## CLI

The packaged CLI now lives under `setup/cli/`. It includes the dispatcher at `setup/cli/ehecatl.sh` and command files under `setup/cli/commands/*.sh`. The installed symlink remains `/usr/local/bin/ehecatl`, so user-facing commands do not include `.sh`.

Runtime and operational commands currently include:

- `start`
- `stop`
- `restart`
- `status`
- `log`
- `tenant_create`
- `firewall_setup`
- `firewall_release`
- `proxy_setup`
- `proxy_release`
- `proxy_release_all`
