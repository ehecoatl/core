# Setup And Maintenance

This page describes the packaged install, bootstrap, and cleanup model used by Ehecoatl.

## Standard Install Flow

The standard host flow is:

1. `ehecoatl-core.sh`
2. `setup/bootstrap.sh`
3. `setup/install.sh`
4. optional bootstraps for Nginx, Redis, and Let's Encrypt

`bootstrap.sh --complete` runs the full packaged flow in one command.

## What `install.sh` Does

`install.sh` configures the runtime under `/opt/ehecoatl`. It:

- loads runtime policy and contract-derived topology
- resolves or generates one install identifier
- creates the packaged runtime identities
- publishes `/usr/local/bin/ehecoatl`
- writes grouped JSON config under `/etc/opt/ehecoatl/config`
- writes install metadata with mode `0644` and the internal install registry record
- installs and enables `ehecoatl.service`
- installs nested built-in extension dependencies for adapters, plugins, app kits, and tenant kits that declare their own `package.json`
- verifies the native seccomp addon is built successfully on Linux

## Identity Model

Base runtime identities:

- `ehecoatl:ehecoatl`
- `g_superScope`
- `g_directorScope`
- `u_supervisor`

Deployment-time identities:

- `u_tenant_{tenant_id}`
- `u_app_{tenant_id}_{app_id}`
- `g_{tenant_id}`
- `g_{tenant_id}_{app_id}`

Human shell access is created separately through `ehecoatl core generate login`.

## Optional Host Bootstraps

Optional bootstraps under `setup/bootstraps/` can provision or integrate:

- Nginx
- the Let's Encrypt client
- Redis

Each bootstrap records whether the component was installer-managed so uninstall can remove only what Ehecoatl actually installed.

## Uninstall

`setup/uninstall.sh` removes the packaged runtime while preserving persisted data. It removes runtime files, the CLI symlink, and the service unit, and it removes installer-created identities only when install metadata says they were created by Ehecoatl.

## Purge

`setup/uninstall/purge-data.sh` removes persisted data under the contract-derived `/etc`, `/var`, and `/srv` runtime roots. It is intended for full cleanup after uninstall.
