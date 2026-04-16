# Architecture

Ehecatl uses a supervised multi-process runtime. The root process boots shared services, launches child processes, and coordinates RPC routing between them.

## Process Roles

### `main`

The root process starts in `app/index.js` and then boots `app/bootstrap/bootstrap-main.js`. It is responsible for:

- loading runtime configuration,
- loading plugins for the `MAIN` context,
- creating the shared RPC router,
- spawning `manager` and `engine_*` child processes,
- spawning `tenant_*` processes on demand through a temporary RPC spawner and reconciling them after tenancy scans,
- supervising health and reload behavior.

### `manager`

The manager process runs shared coordination logic:

- tenancy scans and route lookup,
- queue brokering for pipeline stages,
- heartbeat reporting back to `main`.

### `engine`

Each engine process owns the network adapter and request pipeline:

- accepts HTTP and WebSocket traffic,
- creates an execution context for each request,
- resolves tenant metadata through manager RPC,
- owns session loading, CSRF validation, session persistence, and response cookie generation,
- runs the configured pipeline stages,
- writes the final response.

### `tenant_*`

Tenant child processes are created lazily for specific hosts and can also be proactively ensured after successful tenancy scans. Each one:

- loads tenant-local controller modules from `<tenantRoot>/src/app`,
- exposes the `tenantController` RPC listener,
- returns controller output to the engine process,
- runs with a host-derived runtime user when policy is configured that way.

## Gateway and Adapter Model

The core runtime code lives under `app/_core/gateways`. Each gateway wraps one responsibility and loads an adapter selected from configuration.

Examples:

- `networkEngine` -> `app/adapters/engine/network-engine/*`
- `requestPipeline` -> `app/adapters/engine/request-pipeline/*`
- `tenancyRouter` -> `app/adapters/manager/tenancy-router/*`
- `rpc` -> `app/adapters/shared/rpc/*`
- `storageService` -> `app/adapters/shared/storage-service/*`

This split keeps the orchestration logic inside the gateways while letting transport and backend details vary by adapter.

## Kernel Composition

Each process type has its own kernel constructor:

- `kernel-main.js`
- `kernel-manager.js`
- `kernel-engine.js`
- `kernel-tenant-app.js`

Each kernel receives `{ config, plugin }`, creates a shared `KernelContext`, and instantiates only the gateways needed for that process role.

## RPC Topology

Ehecatl uses a question-and-answer RPC model:

- child processes use `RpcEndpoint`,
- the root process uses `RpcRouter`,
- the default transport is IPC over Node child-process messaging,
- requests are addressed by logical labels such as `main`, `manager`, `engine_0`, or `tenant_www.example.com`.

The main supervisor registers process labels with the router and forwards traffic between the correct endpoints.

## Process Network Isolation

Before selected child processes are launched, the main supervisor can run the `process-firewall` plugin lifecycle hooks to apply per-user inbound firewall rules (`firewall_setup`) and clear them on exit (`firewall_release`). This creates a process-user-level inbound isolation boundary for non-engine processes by default.

## Health Model

Manager and engine processes report heartbeat telemetry every five seconds. The supervisor tracks:

- event loop utilization,
- event loop lag p99,
- event loop lag max,
- heartbeat timeouts.

Unhealthy children are reloaded through the health supervisor.

## Current Boundaries

- HTTP support is the primary implemented request path.
- WebSocket support exists, but the pipeline surface is much thinner than the HTTP path.
- Request concurrency control currently happens through queue stages and manager-side broker logic rather than a dedicated rate-limit pipeline stage.

## Related Reading

- [Request Lifecycle](request-lifecycle.md)
- [Tenancy](tenancy.md)
- [Hooks](../features/hooks.md)
- [Adapters](../features/adapters.md)
