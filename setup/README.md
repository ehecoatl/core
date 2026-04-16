# Setup folder

This folder contains the machine bootstrap, application setup, CLI, uninstall, and purge scripts used by Ehecatl.

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
bash setup/setup-ehecatl.sh --yes --non-interactive
bash setup/setup-ehecatl.sh --dry-run
bash setup/bootstrap-system.sh --dry-run
bash setup/bootstrap-redis.sh --dry-run
```

## Expected order

1. `bootstrap-system.sh`
   - Prepares the host for Ehecatl.
   - Installs Node.js 24 when needed.
   - Clones or validates the project checkout.
   - Does **not** install Redis.

2. `setup-ehecatl.sh`
   - Installs application dependencies.
   - Creates runtime users and directories.
   - Publishes the `ehecatl` CLI from `setup/cli/ehecatl.sh` to `/usr/local/bin/ehecatl`.
   - Creates split JSON config files under `/etc/opt/ehecatl/config` from `app/config/default.config.js`.
   - Installs and enables the Ehecatl systemd service.

3. `bootstrap-redis.sh` *(optional)*
   - Installs and enables a **local** Redis service only when you want Redis managed by Ehecatl.
   - Accepts only the supported Redis major configured by `EHECATL_REDIS_MAJOR`.
   - Current default support is **Redis 7.x only**.
   - If a compatible Redis installation already exists, it is reused and remains externally owned.
   - Updates `sharedCacheService.json` so the cache adapter points to Redis.

## CLI

The packaged CLI now lives under `setup/cli/`:

- dispatcher: `setup/cli/ehecatl.sh`
- commands: `setup/cli/commands/*.sh`

The installed symlink remains clean and user-facing as:

- `/usr/local/bin/ehecatl`

## Maintenance scripts

- `uninstall-ehecatl.sh`
  - Removes the Ehecatl application, CLI symlink, and service.
  - Preserves custom data.
  - Preserves Redis.

- `uninstall-redis.sh`
  - Removes Redis **only** when Redis was previously installed by `bootstrap-redis.sh`.
  - Must not be used for external or manually managed Redis installations.

- `purge-ehecatl-data.sh`
  - Removes Ehecatl custom data under `/etc`, `/var`, and `/srv` policy paths.
  - Does not remove Redis.

## Metadata

The scripts share installation state through:

- `/etc/opt/ehecatl/install-meta.env`

That file records application paths and, when applicable, Redis ownership details used by the uninstall scripts.

## Typical flows

### Local Redis managed by Ehecatl

```bash
bash setup/bootstrap-system.sh
bash /opt/ehecatl/setup/setup-ehecatl.sh
bash /opt/ehecatl/setup/bootstrap-redis.sh
```

### Existing external Redis

```bash
bash setup/bootstrap-system.sh
bash /opt/ehecatl/setup/setup-ehecatl.sh
```

### Remove application but keep data and Redis

```bash
bash /opt/ehecatl/setup/uninstall-ehecatl.sh
```

### Remove installer-managed Redis separately

```bash
bash /opt/ehecatl/setup/uninstall-redis.sh
```

### Purge Ehecatl data

```bash
bash /opt/ehecatl/setup/purge-ehecatl-data.sh
```
