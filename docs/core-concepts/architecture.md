# Architecture

Ehecoatl uses a supervised multi-process runtime with a strict four-scope filesystem and access model:

- `internal-scope`: hidden runtime/install scope owned by `ehecoatl:ehecoatl`
- `supervision-scope`: service-level editable scope exposed through `g_superScope`
- `tenant-scope`: tenant-level editable scope exposed through `g_tenantScope_{tenant_id}`
- `app-scope`: app-level editable scope exposed through `g_appScope_{tenant_id}_{app_id}`

The service and every forked runtime process run as the same hidden internal identity, `ehecoatl:ehecoatl`. Human access is intentionally separate from runtime ownership.

## Scope Model

### `internal-scope`

The internal scope is not a login surface. It owns:

- the packaged installation tree,
- internal runtime state under the service var/lib roots,
- runtime registries,
- managed-login registry data,
- process-owned files created by the service itself.

This is the only scope that owns protected install/runtime files.

### `supervision-scope`

The supervision scope is the service-operator layer. It contains only service-level editable surfaces such as:

- service config overrides,
- service extensions,
- service logs exposed for operator inspection.

It is reached through `g_superScope`. It is intentionally isolated from tenant and app trees.

### `tenant-scope`

The tenant scope contains one tenant's shared editable assets, such as:

- tenant config,
- tenant shared plugins,
- tenant route metadata,
- tenant app deployment surface.

It is reached through `g_tenantScope_{tenant_id}` and is isolated from supervision, internal, and app scopes.

### `app-scope`

The app scope contains one app's editable assets only. It is reached through `g_appScope_{tenant_id}_{app_id}` and is isolated from every other scope.

## Runtime Process Roles

### `main`

The main process starts in `ehecoatl-runtime/index.js` and boots `bootstrap-main.js`. It is responsible for:

- loading runtime configuration,
- loading plugins for the `MAIN` context,
- creating the shared RPC resolver,
- spawning only `director` during initial bootstrap,
- receiving reconciliation requests from `director`,
- spawning `e_transport_{tenant_id}` and `e_app_{tenant_id}_{app_id}` on demand,
- supervising health and reload behavior.

### `director`

The director process handles:

- tenant directory scans and active registry maintenance,
- reconciliation of tenant transport processes,
- reconciliation of isolated app runtimes,
- route/runtime lookup data for transports,
- queue cleanup and coordination,
- heartbeat reporting back to `main`.

### `e_transport_{tenant_id}`

Each transport process owns ingress orchestration for one tenant:

- accepts HTTP and WebSocket traffic,
- builds execution context per request,
- resolves tenant metadata through director RPC,
- runs the middleware stack,
- writes the final response.

### `e_app_{tenant_id}_{app_id}`

Each isolated app runtime:

- loads one app's action modules,
- exposes the action RPC listener,
- returns action output to its transport process,
- still runs as `ehecoatl:ehecoatl`, with isolation enforced by scope groups and path boundaries rather than per-process login users.

## Runtime Ownership

All runtime processes use the internal identity:

- user: `ehecoatl`
- group: `ehecoatl`
- shell: `nologin`

Auto-generated scope users still exist in the model:

- `u_supervisor_{install_id}`
- `u_tenant_{tenant_id}`
- `u_app_{tenant_id}_{app_id}`

but they are also `nologin` and are no longer runtime owners. Human shell access is provided only through custom managed logins created by `ehecoatl core generate login`.

## Gateway and Port Model

The core runtime code lives under focused folders such as:

- `_core/runtimes`
- `_core/orchestrators`
- `_core/managers`
- `_core/resolvers`
- `_core/compilers`
- `_core/services`

Each module keeps one responsibility and loads a port implementation selected from configuration.

Examples:

- `tenantRegistryResolver` persists active tenant/app snapshots under the runtime registry tree declared by the `internal-scope` contract
- `requestUriRouteResolver` consumes the active tenant, domain, and alias registry maintained by tenancy scanning
- `rpcRuntime`, `webServerService`, `storageService`, and `sharedCacheService` stay adapter-backed use cases

## RPC Topology

Ehecoatl uses question-and-answer RPC over child-process IPC:

- child processes use `RpcRuntime`,
- the root process uses `RpcResolver`,
- requests are addressed by logical labels such as `main`, `director`, `e_transport_{tenant_id}`, and `e_app_{tenant_id}_{app_id}`.

The main orchestrator registers process labels and forwards traffic between the correct runtimes.

## Process Network Isolation

The launcher path may still run tightly scoped firewall hooks before selected child processes start, but process isolation is no longer modeled as separate login identities per runtime child. Instead, the service keeps one hidden runtime identity and relies on scope groups and path boundaries for normal filesystem isolation.

The privileged launcher bridge remains intentionally narrow:

- `CAP_NET_ADMIN` is kept only on the launcher path that needs it,
- runtime children drop inherited capabilities before normal execution,
- normal service logic runs without interactive login capability.

## Health Model

Director and transport processes report heartbeat telemetry every five seconds. The supervisor tracks:

- event loop utilization,
- event loop lag percentiles,
- event loop lag max,
- heartbeat timeouts.

Unhealthy children are reloaded through the health supervisor.

## Current Boundaries

- HTTP is the primary implemented request path.
- WebSocket support exists but is thinner than the HTTP path.
- Request concurrency control currently lives in queue middlewares and director-side broker logic.
- CLI targeting now defaults to current working directory for tenant/app commands; there is no saved CLI environment workflow.

## Related Reading

- [Request Lifecycle](request-lifecycle.md)
- [Tenancy](tenancy.md)
- [Hooks](../features/hooks.md)
- [Adapters](../features/adapters.md)
