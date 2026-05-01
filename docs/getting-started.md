# Getting Started

This guide covers the first successful install and deploy path for a local or test environment.

## Install

The standard packaged flow is:

```bash
sudo bash ehecoatl-core.sh --download "<release>"
sudo bash ehecoatl-core.sh --install "<release>"
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
ehecoatl core deploy tenant "@example.test" -t "test"
```

Then move into the tenant root and deploy an app:

```bash
cd /var/opt/ehecoatl/tenants/tenant_example.test
ehecoatl tenant deploy app "www" -a "test"
```

If you are outside the tenant directory but want to target a tenant explicitly, you can also use:

```bash
ehecoatl tenant "@example.test" deploy app "www" -a "test"
```

Both deploy flows finish by triggering `ehecoatl core rescan tenants`, so the running `director` process picks up the new topology immediately.

Kit sources may be folders or `.zip` archives. A zip kit such as `test.zip` must place kit files directly at the archive root.

## Human Logins

Human shell access is created explicitly through the CLI:

```bash
ehecoatl core generate login "operator" --scope super
```

You can attach more than one scope:

```bash
ehecoatl core generate login "editor" --scope super --scope "@example.test"
```

Managed logins still land in `/home/<username>` as their real shell home. The command also creates a scoped workspace at `~/ehecoatl` with symlinks into the service, tenant, and app roots that the assigned scopes allow.

Login scopes are limited to `super`, `"@<domain>"`, and `"@<tenant_id>"`. App-specific login generation is intentionally not exposed; app commands can be reached from tenant-granted workspaces after changing into an app root. Tenant commands also support an explicit `"@<domain>"` override immediately after `tenant` when you want to target a tenant without relying on the current directory.

## Remove The Runtime

To remove the runtime while preserving tenant data:

```bash
sudo bash ehecoatl-core.sh --uninstall
```

To remove the persisted data as well:

```bash
./setup/uninstall.sh --purge
```
