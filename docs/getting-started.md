# Getting Started

This guide covers the first successful install and deploy path for a local or test environment.

## Install

The standard packaged flow is:

```bash
sudo bash ehecoatl-core.sh --download <release>
sudo bash ehecoatl-core.sh --install <release>
sudo bash ehecoatl-core.sh --installed-version
```

That flow installs the runtime under `/opt/ehecoatl`, writes grouped JSON config under `/etc/opt/ehecoatl/config`, enables `ehecoatl.service`, and creates the base runtime identities:

- `ehecoatl:ehecoatl`
- `g_superScope`
- `g_directorScope`
- `u_supervisor`

Tenant and app identities are created later when those scopes are deployed.

## Start And Inspect The Service

```bash
ehecoatl core start
ehecoatl core status
ehecoatl core log
```

## Deploy A Tenant And App

Create a tenant:

```bash
ehecoatl core deploy tenant @example.test -t test-tenant
```

Then move into the tenant root and deploy an app:

```bash
cd /var/opt/ehecoatl/tenants/tenant_<tenant_id>
ehecoatl tenant deploy app www -a test-app
```

Both deploy flows finish by triggering `ehecoatl core rescan tenants`, so the running `director` process picks up the new topology immediately.

## Human Logins

Human shell access is created explicitly through the CLI:

```bash
ehecoatl core generate login operator --scope super
```

You can attach more than one scope:

```bash
ehecoatl core generate login editor --scope super --scope tenant:@example.test
```

Managed logins still land in `/home/<username>` as their real shell home. The command also creates a scoped workspace at `~/ehecoatl` with symlinks into the service, tenant, and app roots that the assigned scopes allow.

When a login includes tenant or app scopes, change into one of those linked roots first and then run `ehecoatl tenant ...` or `ehecoatl app ...`.

## Remove The Runtime

To remove the runtime while preserving tenant data:

```bash
sudo bash ehecoatl-core.sh --uninstall
```

To remove the persisted data as well:

```bash
./setup/uninstall.sh --purge
```
