# Setup and Maintenance

## Packaged Flow

The packaged flow is:

1. `setup/downloader-ehecoatl.sh`
2. `setup/bootstrap-ehecoatl.sh`
3. `setup/setup-ehecoatl.sh`
4. optional bootstraps for Nginx, Redis, and Let's Encrypt

## `setup/setup-ehecoatl.sh`

Setup configures the installed runtime under `/opt/ehecoatl`. It now:

- loads runtime policy and contract-derived setup topology,
- resolves or generates one opaque `install_id`,
- creates `ehecoatl:ehecoatl` as the internal `nologin` runtime identity,
- creates `g_superScope`,
- creates the auto-generated `u_supervisor_{install_id}` scope user as `nologin`,
- publishes `/usr/local/bin/ehecoatl`,
- writes split JSON config under `/etc/opt/ehecoatl/config`,
- writes install metadata and an internal install registry record,
- installs and enables `ehecoatl.service`.

It does not create default child-process OS users anymore.

## Identity Model

- `ehecoatl:ehecoatl`
  Internal runtime/process owner
- `u_supervisor_{install_id}`
  Auto-generated supervision scope user, `nologin`
- `u_tenant_{tenant_id}`
  Auto-generated tenant scope user, `nologin`, created on tenant deploy
- `u_app_{tenant_id}_{app_id}`
  Auto-generated app scope user, `nologin`, created on app deploy

Human access is expected through managed logins created later with:

- `ehecoatl core generate login ...`

## Uninstall

`setup/uninstall-ehecoatl.sh` removes the packaged runtime while preserving persisted data. It removes installer-created internal and scope identities only when metadata says they were created by setup, and it also removes the install registry record together with install metadata.

## Runtime CLI

After setup, use:

- `ehecoatl core start`
- `ehecoatl core stop`
- `ehecoatl core restart`
- `ehecoatl core status`
- `ehecoatl core log`

Tenant and app commands derive their target from the current directory instead of a saved CLI context.
