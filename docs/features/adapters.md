# Adapters

Ehecatl uses adapters to keep core orchestration separate from transport and backend details.

## How Adapter Resolution Works

At startup, `default.user.config.js`:

1. loads `default.config.js`,
2. replaces matching top-level sections with JSON files from the external config folder,
3. builds `_adapters` entries for bundled adapter paths under `app/adapters`
4. builds `_adapters` entries for custom adapter paths under `/etc/opt/ehecatl/adapters`

Each gateway inherits from `GatewayCore` and loads its configured adapter lazily.

## Bundled Adapter Catalog

### Main

- `processSupervisor`: `child-process`

### Engine

- `networkEngine`: `uws`, `express`
- `requestPipeline`: `default-pipeline`
- `sessionRouter`: `default-session`

### Manager

- `queueBroker`: `event-memory`
- `tenancyRouter`: `default-tenancy`

### Shared

- `rpc`: `ipc`
- `storageService`: `local`
- `sharedCacheService`: `local-memory`, `redis`

## What The Bundled Adapters Do

- `child-process` spawns Node child processes with `fork()`.
- `uws` is the primary production transport path for HTTP traffic.
- `default-pipeline` defines the ordered request stages.
- `default-session` handles engine-side session loading, CSRF validation, cookie generation, and session persistence.
- `default-tenancy` scans the tenants filesystem and matches routes.
- `event-memory` implements in-process queue brokering inside the manager.
- `ipc` sends RPC messages through Node process messaging.
- `local` uses the local filesystem for storage operations.
- `redis` and the Map-backed `local-memory` adapter provide alternative shared-cache backends.

## Custom Adapters

Custom adapters live outside the repository by default:

```text
/etc/opt/ehecatl/adapters
```

This lets one deployment replace a gateway backend without modifying the shipped Ehecatl files.

## Documentation Caveats

- The default config selects `uws`, `redis`, and other adapters even when alternative bundled adapters also exist.
- Presence of an adapter file does not guarantee that every branch is production-complete.
- The adapter surface is strongest around the HTTP runtime, IPC, local storage, tenant routing, and process supervision paths.
