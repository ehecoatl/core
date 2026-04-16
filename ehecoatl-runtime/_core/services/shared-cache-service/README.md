# Shared Cache Service

## Purpose

Shared cache service use case for key/value and list-style cache operations with fail-open policy support.

## Context

- Kernel contexts: `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`
- Core file: `shared-cache-service.js`
- Adapter-backed: yes
- Default adapter: `local-memory`

## Current Behavior

- Wraps cache adapter calls in plugin hooks.
- Connects the adapter lazily once before cache operations run.
- Applies operation-specific fail-open rules when configured.

## Ambiguities

- The service surface includes list operations, but backend parity is not consistent across bundled adapters.
- Cache semantics are partly shaped by failure-policy config, so runtime behavior may intentionally differ between deployments.

## Not Implemented Yet

- The bundled Redis adapter leaves `appendListAdapter` and `getListAdapter` blank in this repo snapshot.
