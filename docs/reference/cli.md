# CLI Reference

The installed `ehecoatl` command dispatches by explicit scope:

- `ehecoatl core ...`
- `ehecoatl tenant ...`
- `ehecoatl app ...`
- `ehecoatl firewall ...`

Authorization is group-based:

- `root` can run every scope.
- `g_superScope` can run `core`.
- `g_tenantScope_{tenant_id}` can run `tenant`.
- `g_appScope_{tenant_id}_{app_id}` can run `app`.
- `firewall` is root-only.

Tenant and app commands resolve their target from the current working directory. There is no saved CLI context and no `enter`, `exit`, or `back` workflow anymore.

## Core

- `ehecoatl core start`
- `ehecoatl core stop`
- `ehecoatl core restart`
- `ehecoatl core status`
- `ehecoatl core log`
- `ehecoatl core list`
- `ehecoatl core deploy tenant @<domain> [--repo <repo_url>] [-t <tenant_kit>]`
- `ehecoatl core delete tenant @<domain>|@<tenant_id>`
- `ehecoatl core generate login <username> [--password <password>] --scope <selector>...`
- `ehecoatl core delete login <username> [--purge-home]`

`core generate login` supports these scope selectors:

- `super`
- `tenant:@<domain>`
- `tenant:@<tenant_id>`
- `app:<app_name>@<domain>`
- `app:<app_id>@<tenant_id>`

If `--password` is omitted, the created login remains password-locked.

## Tenant

Run tenant commands from inside a tenant root or tenant shared path, not from inside an app path.

- `ehecoatl tenant deploy app <app_name> [--repo <repo_url>] [-a <app_kit>]`
- `ehecoatl tenant delete app <app_name>`
- `ehecoatl tenant list`
- `ehecoatl tenant status`
- `ehecoatl tenant log`
- `ehecoatl tenant config [--get <key>] [--set <key> "<value>"]`
- `ehecoatl tenant enable`
- `ehecoatl tenant disable`
- `ehecoatl tenant make plugin <name>`

`deploy app` requires the current directory to already be inside the target tenant scope.

## App

Run app commands from inside an app root.

- `ehecoatl app status`
- `ehecoatl app log`
- `ehecoatl app config [--get <key>] [--set <key> "<value>"]`
- `ehecoatl app enable`
- `ehecoatl app disable`
- `ehecoatl app make <middleware|plugin|action> <name>`

The `app` scope has no `list` command and no cross-scope target override.

## Firewall

- `ehecoatl firewall newtork_wan_block <on|off> <username> [process-label] [input-chain]`
- `ehecoatl firewall newtork_local_proxy <on|off> <username>[:<port>[,<port>...]]`

`newtork_wan_block` manages WAN-facing TCP fencing for one process owner. It allows loopback traffic and rejects non-loopback TCP access for the user-owned listening surface, while also rejecting non-loopback outbound TCP for that same user.

`newtork_local_proxy` restricts one process owner to loopback access only for the explicitly allowed local ports, usually the tenant internal proxy ports in the `14000+` range. Multiple ports can be passed as a comma-separated list.

## Notes

- Deploy persists `--repo` immediately into the target `config.json` as `source.repoURL`.
- Auto-generated scope users such as `u_supervisor_*`, `u_tenant_*`, and `u_app_*` are `nologin`.
- Human shell access is expected through managed logins created by `core generate login`.
