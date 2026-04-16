# Setup folder

This folder contains only the shell bootstrap, setup, uninstall, and purge entrypoints used by Ehecoatl.

All packaged installation and runtime assets that are intended to live under `/opt/ehecoatl` now live under `ehecoatl-runtime/`, including the CLI, contracts, templates, systemd unit, helper libraries, and built-in extensions.

## Common execution options

All primary setup scripts accept these options:

- `--yes`
  - Auto-confirms prompts that would otherwise require manual confirmation.
- `--non-interactive`
  - Disables interactive prompts.
  - When a destructive or decision-based prompt would be required, the script fails unless `--yes` is also provided.
  - `uninstall-ehecoatl.sh` and `purge-ehecoatl-data.sh` are stricter and always require interactive secure confirmation.
- `--dry-run`
  - Shows what would be installed and what would be changed.
  - Makes no system changes.
  - Also implies non-interactive execution.
- `--auto-installer`
  - On `downloader-ehecoatl.sh`, runs `bootstrap-ehecoatl.sh` automatically at the end.
  - On `bootstrap-ehecoatl.sh`, runs `setup-ehecoatl.sh` automatically at the end.
  - When combined on downloader, the full chain becomes downloader -> bootstrap -> setup.
  - Inherits `--non-interactive` and `--dry-run` when present.
- `--complete`
  - On `bootstrap-ehecoatl.sh`, implies `--auto-installer`.
  - Runs `bootstrap -> setup -> bootstrap-nginx -> bootstrap-lets-encrypt -> bootstrap-redis`.
  - Inherits `--yes`, `--non-interactive`, and `--dry-run` when present.

`uninstall-ehecoatl.sh` and `purge-ehecoatl-data.sh` additionally require the interactive secure confirmation token `E-H-E-C-O-A-T-L`.

Typical examples:

```bash
bash setup/setup-ehecoatl.sh --yes --non-interactive
bash setup/setup-ehecoatl.sh --dry-run
bash setup/downloader-ehecoatl.sh --dry-run
bash setup/bootstrap-ehecoatl.sh --dry-run
bash setup/bootstraps/bootstrap-nginx.sh --dry-run
bash setup/bootstraps/bootstrap-lets-encrypt.sh --dry-run
bash setup/bootstraps/bootstrap-redis.sh --dry-run
```

## Expected order

1. `downloader-ehecoatl.sh`
   - Installs `git` when needed.
   - Resolves the most recent downloadable release tag by default, or a specific `--ref` when provided.
   - Downloads into `~/ehecoatl/<tag-or-commit>` so multiple versions can coexist.
   - Reuses an already-downloaded version instead of downloading it again.
   - Treats downloaded checkouts as intentional local cache; remove them manually when no longer needed.
   - Prepares the source checkout required by the remaining setup scripts.

2. `bootstrap-ehecoatl.sh`
   - Prepares the host for Ehecoatl.
   - Installs Node.js 24 when needed.
   - Requires a local checkout that already contains `ehecoatl-runtime/` and `setup/`.
   - Copies only the `ehecoatl-runtime/` payload into `/opt/ehecoatl`.
   - Does **not** uninstall or roll back host prerequisites later; those are preserved intentionally.

3. `setup-ehecoatl.sh`
   - Installs application dependencies.
   - Creates runtime users and directories.
   - Creates the `g_director` scope group used by director-managed writers such as the web-server sync.
   - Creates the service-runtime filesystem topology from contract-derived setup topology, rather than from a separate hardcoded setup model.
   - Creates `/root/ehecoatl` as a root-only administrative workspace and materializes contract-defined helper symlinks there.
   - Publishes the `ehecoatl` CLI from `ehecoatl-runtime/cli/ehecoatl.sh` to `/usr/local/bin/ehecoatl`.
   - Creates grouped config files under `/etc/opt/ehecoatl/config/{runtime,plugins,adapters}/{key}.json` from `ehecoatl-runtime/config/default.config.js`.
   - Installs and enables the Ehecoatl systemd service.

## Contracts and Setup

`setup/` is the installation and maintenance layer. It does not define the runtime topology independently.

The structural source of truth lives in `ehecoatl-runtime/contracts/`, and setup consumes contract-derived outputs for:

- service-runtime topology creation
- runtime-policy resolution
- process identity assumptions
- installed runtime path expectations

4. `bootstraps/bootstrap-nginx.sh` *(optional)*
   - Installs and enables a local `nginx` service only when it is missing.
   - If `nginx` already exists, it is reused and remains externally owned.
   - Prepares `/etc/nginx/conf.d/ehecoatl` with group ownership and default ACLs for `g_director`, so the director-side web server sync can manage generated tenant configs.
   - Records ownership metadata so `uninstall-ehecoatl.sh` removes the package only when bootstrap installed it.

5. `bootstraps/bootstrap-lets-encrypt.sh` *(optional)*
   - Installs a local `certbot` client and also the `letsencrypt` package when the host repository still provides it.
   - If those packages already exist, they are reused and remain externally owned.
   - Records ownership metadata so `uninstall-ehecoatl.sh` removes only the installer-managed Let's Encrypt packages.

6. `bootstraps/bootstrap-redis.sh` *(optional)*
   - Installs and enables a **local** Redis service only when you want Redis managed by Ehecoatl.
   - Accepts only the supported Redis major configured by `EHECOATL_REDIS_MAJOR`.
   - Current default support is **Redis 7.x only**.
   - If a compatible Redis installation already exists, it is reused and remains externally owned.
   - Updates `adapters/sharedCacheService.json` so `adapter` points to Redis.

## CLI

The packaged CLI now lives under `ehecoatl-runtime/cli/`:

- dispatcher: `ehecoatl-runtime/cli/ehecoatl.sh`
- commands: `ehecoatl-runtime/cli/commands/*.sh`

## Templates

Packaged tenant kits live under:

- `ehecoatl-runtime/extensions/tenant-kits/empty-tenant/`
  - default tenant scaffold kit cloned by `ehecoatl deploy`
  - includes `.ehecoatl/lib/nginx.e.conf`, the tenant-local nginx template cloned into each tenant and later re-used by `web-server-service` for every nginx source update

The installed symlink remains clean and user-facing as:

- `/usr/local/bin/ehecoatl`

The root-only administrative helper workspace is:

- `/root/ehecoatl/.core -> /opt/ehecoatl`
- `/root/ehecoatl/.etc -> /etc/opt/ehecoatl`
- `/root/ehecoatl/.var -> /var/opt/ehecoatl`
- `/root/ehecoatl/.srv -> /srv/opt/ehecoatl`

## Maintenance scripts

- `uninstall-ehecoatl.sh`
  - Removes the Ehecoatl application, CLI symlink, and service.
  - Removes the contract-defined helper symlinks under `/root/ehecoatl`.
  - Removes runtime users/groups only when setup originally created them.
  - Preserves custom data.
  - Preserves Redis.
  - Preserves host prerequisites installed by downloader, bootstrap, or setup.
  - Removes the Nginx package only when it was previously installed by `bootstraps/bootstrap-nginx.sh`.
  - Removes the Let's Encrypt client only when it was previously installed by `bootstraps/bootstrap-lets-encrypt.sh`.
  - Requires the secure confirmation token `E-H-E-C-O-A-T-L`.

- `uninstall/uninstall-redis.sh`
  - Removes Redis **only** when Redis was previously installed by `bootstraps/bootstrap-redis.sh`.
  - Restores `adapter` to `local-memory` in `adapters/sharedCacheService.json`.
  - Must not be used for external or manually managed Redis installations.

- `purge-ehecoatl-data.sh`
  - Removes Ehecoatl custom data under `/etc`, `/var`, and `/srv` policy paths.
  - Removes the contract-defined helper symlinks under `/root/ehecoatl`.
  - Does not remove Redis.
  - Requires the secure confirmation token `E-H-E-C-O-A-T-L`.

## Metadata

The scripts share installation state through:

- `/etc/opt/ehecoatl/install-meta.env`

That file records application paths, runtime identity ownership created by setup, the persisted `g_director` scope group, and, when applicable, Redis and Let's Encrypt ownership details used by the uninstall scripts.

## Typical flows

### Local Nginx, Let's Encrypt, and Redis managed by Ehecoatl

```bash
bash setup/downloader-ehecoatl.sh
bash setup/bootstrap-ehecoatl.sh
bash setup/setup-ehecoatl.sh
bash setup/bootstraps/bootstrap-nginx.sh
bash setup/bootstraps/bootstrap-lets-encrypt.sh
bash setup/bootstraps/bootstrap-redis.sh
```

### Existing external Redis

```bash
bash setup/downloader-ehecoatl.sh
bash setup/bootstrap-ehecoatl.sh
bash setup/setup-ehecoatl.sh
```

### Remove application but keep data and Redis

```bash
bash setup/uninstall-ehecoatl.sh
```

### Remove installer-managed Redis separately

```bash
bash setup/uninstall/uninstall-redis.sh
```

### Purge Ehecoatl data

```bash
bash setup/purge-ehecoatl-data.sh
```
