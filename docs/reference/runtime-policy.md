# Runtime Policy

Ehecatl keeps operational policy in `app/config/runtime-policy.json` so that both Node.js code and shell scripts can resolve the same system rules.

## Why It Exists

Without a shared policy file, the Node runtime and setup or CLI scripts would duplicate:

- runtime usernames,
- filesystem roots,
- tenant ownership rules,
- firewall command names,
- ACL expectations.

The runtime policy keeps those concerns aligned.

## Main Sections

### `system`

Defines the shared runtime user and group.

### `paths`

Defines the standard installation roots:

- tenants base
- var base
- srv base
- etc base

### `processUsers`

Defines how runtime users are assigned for:

- `main`
- `manager`
- `engine`
- `tenant`

The tenant rule currently uses a host-derived prefix strategy such as `e_tenant_<host>`.

### `tenantLayout`

Defines default owners, groups, and modes for:

- domain base folders
- host folders

### `tenantAccess`

Defines ACL rules for manager and engine access into tenant folders. The bundled policy grants manager read access to `src/config.json` and static-asset reads from `src/public`, while engine access is scoped to `src/public` and writable runtime folders such as `cache`, `log`, and `spool`. Tenant provisioning scripts consume these rules to apply read and write access for the correct runtime users.

### `firewall`

Defines the CLI commands used to set up and release inbound firewall rules for process isolation hooks.

## Where It Is Consumed

Current consumers include:

- `app/config/runtime-policy.js`
- `setup/lib/runtime-policy.sh`
- `setup/setup-ehecatl.sh`
- `setup/cli/commands/tenant_create.sh`
- `setup/cli/commands/firewall_setup.sh`
- bootstrap code that resolves process users before child processes start

## Practical Effect

Changing runtime policy affects both installation and runtime behavior. Treat it as an operational contract, not just a convenience config file.
