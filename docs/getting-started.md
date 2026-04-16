# Getting Started

## Install

The packaged flow is:

```bash
./setup/downloader-ehecoatl.sh
./setup/bootstrap-ehecoatl.sh
./setup/setup-ehecoatl.sh
```

Setup installs the runtime under `/opt/ehecoatl`, enables `ehecoatl.service`, generates one `install_id`, and creates these auto-managed identities:

- `ehecoatl:ehecoatl`
- `g_superScope`
- `u_supervisor_{install_id}` as `nologin`

Tenant and app scope users are created later when those scopes are deployed, and they are also `nologin`.

## Start and Stop

Use:

```bash
ehecoatl core start
ehecoatl core status
ehecoatl core log
ehecoatl core stop
```

## First Tenant and App

Create a tenant:

```bash
ehecoatl core deploy tenant @example.com -t empty-tenant
```

Then move into that tenant root and create an app:

```bash
cd /var/opt/ehecoatl/tenants/tenant_<tenant_id>
ehecoatl tenant deploy app www -a empty-app
```

The `tenant` scope now resolves its target from the current directory. There is no `core enter tenant` workflow anymore.

## Human Logins

Human shell access is created explicitly:

```bash
ehecoatl core generate login operator --scope super
```

Add more scope groups by repeating `--scope`, for example:

```bash
ehecoatl core generate login editor --scope super --scope tenant:@example.com
```

If `--password` is omitted, the login is created with a locked password.

## Uninstall

To remove the packaged runtime while preserving persisted data:

```bash
./setup/uninstall-ehecoatl.sh
```

To remove persisted data too:

```bash
./setup/purge-ehecoatl-data.sh
```
