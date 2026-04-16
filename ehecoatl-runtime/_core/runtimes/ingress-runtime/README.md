# Ingress Runtime

## Purpose

Transport runtime that binds inbound network traffic to execution contexts and director lookups.

## Context

- Kernel context: `TRANSPORT`
- Core files: `ingress-runtime.js`, `director-runtime-resolver.js`
- Adapter-backed: yes
- Default adapter: `uws`

## Current Behavior

- Boots the active ingress adapter through `setupAdapter(...)`.
- Creates `ExecutionContext` instances for inbound requests.
- Exposes a director helper used by the transport middleware stack to resolve routes and shared objects over RPC.

## Ambiguities

- `docs/features/adapters.md` mentions `express`, but this repo snapshot only includes a bundled `uws` ingress adapter.
- The TODO comment about object pooling confirms some runtime optimization work is still deferred.

## Not Implemented Yet

- A bundled `express` ingress adapter is not implemented in this repo snapshot.
- Execution-context object recycling is noted as future work rather than implemented behavior.
