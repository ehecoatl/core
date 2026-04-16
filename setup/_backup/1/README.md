# Setup folder

This folder contains the machine bootstrap, application setup, uninstall, and purge scripts used by Ehecoatl.

## Common execution options

All primary setup scripts accept these options:

- `--yes`
  - Auto-confirms prompts that would otherwise require manual confirmation.
- `--non-interactive`
  - Disables interactive prompts.
  - When a destructive or decision-based prompt would be required, the script fails unless `--yes` is also provided.
- `--dry-run`
  - Shows what would be installed and what would be changed.
  - Makes no system changes.
  - Also implies non-interactive execution.

Typical examples:

```bash
bash setup/setup-ehecoatl.sh --yes --non-interactive
bash setup/setup-ehecoatl.sh --dry-run
bash setup/bootstrap-system.sh --dry-run
bash setup/bootstrap-redis.sh --dry-run
```

## Expected order

1. `bootstrap-system.sh`
   - Prepares the host for Ehecoatl.
   - Installs Node.js 24 when needed.
   - Clones or validates the project checkout.
   - Does **not** install Redis.

2. `bootstrap-redis.sh` *(optional)*
   - Installs and enables a **local** Redis service only when you want Redis managed by Ehecoatl.
   - Accepts only the supported Redis major configured by `EHECOATL_REDIS_MAJOR`.
   - Current default support is **Redis 7.x only**.
   - If a compatible Redis installation already exists, it is reused and remains externally owned.

3. `setup-ehecoatl.sh`
   - Installs application dependencies.
   - Creates runtime users and directories.
   - Publishes the `ehecoatl` CLI.
   - Installs and enables the Ehecoatl systemd service.

## Maintenance scripts

- `uninstall-ehecoatl.sh`
  - Removes the Ehecoatl application, CLI, and service.
  - Preserves custom data.
  - Preserves Redis.

- `uninstall-redis.sh`
  - Removes Redis **only** when Redis was previously installed by `bootstrap-redis.sh`.
  - Must not be used for external or manually managed Redis installations.

- `purge-ehecoatl-data.sh`
  - Removes Ehecoatl custom data under `/etc`, `/var`, and `/srv` policy paths.
  - Does not remove Redis.

## Metadata

The scripts share installation state through:

- `/etc/opt/ehecoatl/install-meta.env`

That file records application paths and, when applicable, Redis ownership details used by the uninstall scripts.

## Typical flows

### Local Redis managed by Ehecoatl

```bash
bash setup/bootstrap-system.sh
bash setup/bootstrap-redis.sh
bash setup/setup-ehecoatl.sh
```

### Existing external Redis

```bash
bash setup/bootstrap-system.sh
bash setup/setup-ehecoatl.sh
```

### Remove application but keep data and Redis

```bash
bash setup/uninstall-ehecoatl.sh
```

### Remove installer-managed Redis separately

```bash
bash setup/uninstall-redis.sh
```

### Purge Ehecoatl data

```bash
bash setup/purge-ehecoatl-data.sh
```
