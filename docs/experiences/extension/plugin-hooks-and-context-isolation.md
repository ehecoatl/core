# Plugin Hooks and Context Isolation

This experience allows lifecycle customization through hooks and plugin boundaries without giving extensions arbitrary ownership over the runtime core.

## Experience

- Integrators can attach behavior to lifecycle moments instead of forking the whole runtime.
- Plugins extend the system inside bounded contexts rather than by mutating unrelated runtime layers.
- The extension surface is real, even though the built-in plugin catalog in this repository remains intentionally small.

## Implementation

- Runtime bootstraps expose lifecycle hook points around process startup and readiness.
- Hook documentation and plugin reference material define where extension logic is expected to live.
- The current repository demonstrates the plugin model through hook infrastructure and the built-in `boot-logger`, `logger-runtime`, and `error-reporter` plugins rather than a large packaged plugin suite.

## Key Files

- [`docs/features/hooks.md`](../../features/hooks.md)
- [`docs/features/plugins.md`](../../features/plugins.md)
- `ehecoatl-runtime/bootstrap/process-main.js`
- `ehecoatl-runtime/bootstrap/process-director.js`
- `ehecoatl-runtime/bootstrap/process-isolated-runtime.js`

## Related Docs

- [Hooks](../../features/hooks.md)
- [Plugins](../../features/plugins.md)
- [RPC and Runtime Topology](../nucleus/rpc-and-runtime-topology.md)
