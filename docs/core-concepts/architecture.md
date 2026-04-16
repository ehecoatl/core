# Architecture

Ehecoatl uses a supervised multi-process runtime with a contract-derived filesystem and identity model.

## Runtime Roles

- `main`
  Root supervisor process responsible for boot, child-process ownership, and high-level orchestration.
- `director`
  Tenancy scan, active registry maintenance, routing support, queue coordination, and shared ingress synchronization.
- `e_transport_{tenant_id}`
  Ingress process for one tenant.
- `e_app_{tenant_id}_{app_id}`
  Isolated app runtime for one deployed application.

## Scope And Identity Model

The runtime uses four logical scopes:

- `internalScope`
- `supervisionScope`
- `tenantScope`
- `appScope`

The corresponding operational groups are:

- `ehecoatl`
- `g_superScope`
- `g_directorScope`
- `g_{tenant_id}`
- `g_{tenant_id}_{app_id}`

The packaged runtime identity is `ehecoatl:ehecoatl`. Scope-specific users such as `u_supervisor`, `u_tenant_{tenant_id}`, and `u_app_{tenant_id}_{app_id}` support ownership and permission boundaries without being the default human login surface.

## Kernel And Runtime Composition

The packaged runtime is assembled from:

- `kernel/`
  Process-specific composition entrypoints
- `runtimes/`
  Long-lived runtime components such as ingress, RPC, request routing, middleware execution, and process supervision
- `resolvers/`
  Lookup and normalization components such as tenancy and plugin registry resolution
- `services/`
  Adapter-backed shared services such as storage, cache, and web-server integration
- `orchestrators/` and `managers/`
  Cross-cutting coordination flows

## RPC Topology

Ehecoatl uses label-addressed RPC between processes:

- `main`
- `director`
- `e_transport_{tenant_id}`
- `e_app_{tenant_id}_{app_id}`

The `director` process also exposes a local Unix socket for direct CLI commands such as `ehecoatl core rescan tenants`.

## Security Boundaries

- The systemd service starts as `root`.
- The bootstrap path applies the configured runtime identity internally.
- Child processes drop inherited capabilities before normal execution.
- `director`, `transport`, and `isolated-runtime` apply a seccomp no-spawn boundary during bootstrap.
- That boundary blocks `fork`, `vfork`, `execve`, and `execveat` while preserving normal thread creation required by Node.js.

## Load Policy

Ehecoatl's core runtime composition is expected to load eagerly during bootstrap and kernel assembly. Lazy-loading arbitrary core runtime, bootstrap, kernel, or resolver files is not supported by design.

This is part of the runtime security model, not only a startup-style preference. The supervised bootstrap path intentionally clears `require.cache` once the long-lived process is ready so bootstrap-time module state is not treated as a supported extension surface.

The supported runtime exceptions are limited to deployment-facing extension code:

- isolated app entrypoints
- app action modules
- tenant and app middleware modules

Those surfaces are loaded intentionally at runtime and refreshed through `weakRequire` based on source-file modification time. See [Request Lifecycle](request-lifecycle.md) and [Tenancy](tenancy.md) for those extension-specific details.

## Related Reading

- [Request Lifecycle](request-lifecycle.md)
- [Tenancy](tenancy.md)
- [CLI Reference](../reference/cli.md)
