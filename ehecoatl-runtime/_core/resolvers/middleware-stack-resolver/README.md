# Middleware Stack Resolver

## Purpose

Transport-only resolver that loads middleware modules into in-memory registries.

## Context

- Kernel context: `TRANSPORT`
- Core file: `middleware-stack-resolver.js`
- Adapter-backed: no

## Current Behavior

- Loads the selected core middleware adapter folder into `coreMiddlewares`.
- Loads tenant-local shared middleware folders into `tenantMiddlewares.http` and `tenantMiddlewares.ws`.
- Lazily loads app-local middleware folders into `appMiddlewares[appId].http/ws`.

## Not Implemented Yet

- It does not change the current HTTP middleware execution path yet.
- It does not invalidate or reload cached app registries during the process lifetime.
