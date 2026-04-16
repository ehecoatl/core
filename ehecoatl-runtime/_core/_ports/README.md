# Ports

## Purpose

The files in `_core/_ports/` define the contract surface between internal use cases and adapter implementations.

In Ehecoatl's current architecture:

- a **use case** owns business-oriented orchestration inside the runtime
- a **port** defines the expected adapter interface for one integration surface
- an **adapter** provides the concrete implementation for filesystem, IPC, process forking, caching, routing compilation, and other external or tool-facing concerns

This keeps business logic and runtime coordination inside the core while allowing infrastructure details to be swapped through adapters.

## What Port Scripts Are

Port scripts are interface-like contract files for adapters.

They define, in practical terms:

- which methods an adapter is expected to expose
- which input and output shapes the core expects
- which external dependency surface is being delegated out of the use case

Ports are not the business logic themselves. They are the boundary definition that an adapter must satisfy.

Typical examples include contracts for:

- inbound runtimes such as the HTTP/WS ingress surface
- outbound runtimes such as process forking, RPC transport, and URI routing
- outbound services such as storage, cache, and webserver integration
- outbound resolvers such as tenant discovery and registry persistence
- outbound compilers and managers where the core delegates specialized infrastructure work

## Role Of `adaptable-use-case.js`

[`adaptable-use-case.js`](./adaptable-use-case.js) is the parent class for internal use cases that need an adapter attached to them.

Its responsibility is intentionally small:

- store the configured adapter path reference
- lazy-load the configured adapter when first needed
- keep the loaded adapter instance available on the use case
- provide a default `destroy()` path that forwards teardown to the adapter when supported

This means the class does **not** implement business logic by itself. Instead, it provides the common adapter-loading behavior used by adapter-backed use cases.

## Architectural Role

Use `AdaptableUseCase` when a use case:

- owns runtime or business orchestration in the core
- depends on external tools, system APIs, or infrastructure implementations
- needs that dependency surface to be pluggable through adapters

In that model:

- the **use case** decides *when* and *why* something should happen
- the **port** defines *what interface* the adapter must satisfy
- the **adapter** decides *how* the external operation is actually performed

## Practical Rule

If a core class needs to orchestrate an external dependency through a configurable implementation, it should:

1. depend on a port contract
2. extend `AdaptableUseCase` when lazy adapter binding is needed
3. keep orchestration and business flow in the use case, not in the adapter

Adapters should stay focused on implementation details, while use cases remain the place where Ehecoatl coordinates runtime behavior.

## Current Grouping

Ports are grouped first by direction and then by dependency role:

- `inbound/runtimes`
- `outbound/runtimes`
- `outbound/services`
- `outbound/resolvers`
- `outbound/compilers`
- `outbound/managers`

The adapters tree mirrors the same grouping so the loader resolves both sides through the same taxonomy.
