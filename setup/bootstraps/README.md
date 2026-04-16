# Optional Bootstraps

This folder contains optional host-component provisioning scripts.

These scripts extend the base `bootstrap -> setup` flow when Ehecoatl is expected to manage local host services directly.

## Included Bootstraps

- `bootstrap-nginx.sh`
  Installs or prepares local Nginx integration.
- `bootstrap-lets-encrypt.sh`
  Installs or prepares the local Let's Encrypt client.
- `bootstrap-redis.sh`
  Installs or prepares a local Redis instance for `sharedCacheService`.

## Ownership Model

Each bootstrap records whether the underlying host component was installer-managed or pre-existing. Uninstall logic removes only the components explicitly marked as managed by Ehecoatl.

This keeps the packaged uninstall flow safe on hosts where Nginx, Redis, or the Let's Encrypt client were already present before Ehecoatl was installed.
