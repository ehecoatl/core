# Core Runtime Layer

`_core/` contains the product's implementation-facing runtime model.

It is the internal layer where kernels assemble use cases, runtime processes load behavior, and shared coordination logic is structured by responsibility.

## Main Areas

- `kernel/`
  Process-specific assembly entrypoints that compose the runtime for `main`, `director`, `transport`, and `isolated-runtime`.
- `runtimes/`
  Long-lived runtime components such as RPC, ingress execution, request routing, middleware execution, and supervised process control.
- `resolvers/`
  Lookup and normalization logic, including tenancy, plugin registry, and middleware resolution.
- `managers/`
  Focused coordination modules such as queue and WebSocket hub management.
- `services/`
  Adapter-backed shared services such as storage, cache, and web-server integration.
- `orchestrators/`
  Cross-cutting coordination flows such as supervision, plugins, and watchdog behavior.
- `_ports/`
  Adaptable base classes and adapter contracts.

## What Belongs Here

- Core runtime behavior that is packaged with Ehecoatl
- Process-agnostic internal abstractions
- Coordination logic shared across multiple runtime contexts

## What Does Not Belong Here

- Host install scripts
- Tenant-local application code
- Deployment kits and packaged examples

See also:

- [Runtime README](../README.md)
- [Bootstrap README](../bootstrap/README.md)
