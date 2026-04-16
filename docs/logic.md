# Runtime Logic Overview

This document summarizes the logic model behind the current Ehecoatl runtime.

It is not a line-by-line implementation guide. Its purpose is to explain the main operating decisions behind the codebase in one place.

## Contracts

Ehecoatl uses contracts as the structural source of truth for:

- runtime layers
- identities
- process labels
- runtime paths
- setup derivation
- CLI shape

This keeps setup, runtime, and operational tooling aligned to one declared model.

## Scope Model

The runtime is organized into four logical scopes:

- `internalScope`
- `supervisionScope`
- `tenantScope`
- `appScope`

At the filesystem and identity level, the visible group model is:

- `ehecoatl`
- `g_superScope`
- `g_directorScope`
- `g_{tenant_id}`
- `g_{tenant_id}_{app_id}`

## Process Model

The main runtime roles are:

- `main`
  root supervisor bootstrap and child-process owner
- `director`
  tenancy scan, registry, reconciliation, and shared coordination
- `e_transport_{tenant_id}`
  ingress execution for one tenant
- `e_app_{tenant_id}_{app_id}`
  isolated application runtime for one app

Runtime identities are distinct from human shell access. Managed shell users are created explicitly through the CLI and are separate from the packaged runtime identities.

## Ownership Model

The packaged runtime keeps one protected internal runtime identity:

- `ehecoatl:ehecoatl`

Scope-specific identities are created for supervision, tenant, and app ownership:

- `u_supervisor`
- `u_tenant_{tenant_id}`
- `u_app_{tenant_id}_{app_id}`

These identities are primarily used for scope ownership and permission boundaries rather than as interactive shell users.

## Director Responsibility

`director` is the active runtime reconciler. It:

- scans tenant and app topology
- updates active registry state
- resolves request routing inputs
- coordinates shared queue cleanup and web-server sync
- now accepts direct CLI-triggered rescans through the director RPC socket

## Security Boundaries

The launcher path starts with elevated privilege so it can apply runtime identities and host-level setup safely. After bootstrap:

- child processes drop inherited capabilities
- protected child processes apply a seccomp no-spawn boundary
- the seccomp boundary blocks `fork`, `vfork`, `execve`, and `execveat`
- thread creation required by the Node.js runtime remains available

## Load Policy

The same security model also defines how code is loaded.

- Core bootstrap and runtime composition are expected to load eagerly.
- Lazy-loading arbitrary core files is not supported by design.
- `main`, `director`, and `transport` clear `require.cache` after their `READY` path completes.
- `isolated-runtime` clears `require.cache` before weak-loading the app entrypoint and serving action modules.
- `clearRequireCache()` also clears tracked `weakRequire` state.

Only deployment-facing extension surfaces are intentionally weak-loaded at runtime:

- isolated app entrypoints
- app action modules
- tenant and app middleware modules

Those surfaces use `weakRequire` so a changed or deleted source file clears stale module state before the next load attempt.

## Request Execution

The transport path is the main HTTP execution surface. It:

- normalizes request data
- resolves a tenant route through the `director`
- runs the middleware stack
- forwards action execution to the isolated app runtime when needed
- writes the final response in the transport process

For the detailed flow, see [Request Lifecycle](core-concepts/request-lifecycle.md).
