# Adapters

Ehecoatl uses adapters to keep core orchestration separate from transport and backend details.

## How Adapter Resolution Works

At startup, `default.user.config.js`:

1. loads `default.config.js`,
2. replaces matching top-level sections with JSON files from the external config folder,
3. builds `_adapters` entries for bundled adapter paths under `ehecoatl-runtime/extensions/adapters`
4. builds `_adapters` entries for custom adapter paths under `runtime.customAdaptersPath`

Each adaptable core module loads its configured adapter lazily through a sibling `*Port` contract.

## Bundled Adapter Catalog

### Main

- `processForkRuntime`: `child-process`

### Transport

- `ingressRuntime`: `uws`, `express`
- `middlewareStackOrchestrator`: `default-middleware-stack`

### Director

- `queueBroker`: `event-memory`
- `tenantDirectoryResolver`: `default-tenancy` under `tenant-directory-resolver`
- `tenantRegistryResolver`: `default-runtime-registry-v1` under `tenant-registry-resolver`
- `tenantRouteMatcherCompiler`: `default-routing-v1` under `tenant-route-matcher-compiler`
- `requestUriRouteResolver`: `default-uri-router-runtime` under `request-uri-route-resolver`
- `webServerService`: `native-tls-proxy` under `web-server-service`

### Shared

- `rpcRuntime`: `ipc`
- `storageService`: `local`
- `sharedCacheService`: `local-memory`, `redis`

## What The Bundled Adapters Do

- `child-process` spawns Node child processes with `fork()`.
- `uws` is the primary production transport path for HTTP traffic.
- `default-middleware-stack` defines the ordered transport middlewares.
- `default-tenancy` scans the tenants filesystem and builds the active tenant app, domain, and domain-alias registry used by the route runtime.
- `event-memory` implements in-process queue management inside the director.
- `ipc` sends RPC messages through Node process messaging.
- `local` uses the local filesystem for storage operations.
- `redis` and the Map-backed `local-memory` adapter provide alternative shared-cache backends.

Session and CSRF behavior is no longer implemented as an adapter-backed use case. It now lives in the built-in `session-runtime` plugin, which uses generic request and middleware-stack hooks together with `sharedCacheService`.

Transport middleware and tenant/app middleware are now documented as two layers of the broader middleware model. The transport middleware stack runs in the transport request path, while tenant/app middleware remains route metadata and tenant-local extension space under `app/middlewares`.

`watchdogOrchestrator` is a core main-process orchestrator use case, but it is not adapter-backed.

## Custom Adapters

Custom adapters live outside the repository by default:

```text
/srv/opt/ehecoatl/adapters
```

This lets one deployment replace a use-case adapter backend without modifying the shipped Ehecoatl files.

## Documentation Caveats

- The default config selects `uws`, `redis`, and other adapters even when alternative bundled adapters also exist.
- Presence of an adapter file does not guarantee that every branch is production-complete.
- The adapter surface is strongest around the HTTP runtime, IPC, local storage, tenant routing, and process supervision paths.
