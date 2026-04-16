# Configuration

Ehecoatl is configured from `ehecoatl-runtime/config/default.config.js` plus grouped JSON overrides under `/etc/opt/ehecoatl/config`.

## Load Model

The runtime:

1. loads `default.config.js`
2. reads grouped JSON overrides from the external config tree
3. replaces matching top-level sections
4. derives adapter lookup paths into `config._adapters`

Overrides are section-based, not deep-merged across arbitrary files.

## Main Configuration Areas

### `runtime`

Defines runtime paths and grouped configuration roots such as:

- custom config
- custom adapters
- custom plugins

`runtime.security.seccomp.mode` controls the protected child-process no-spawn boundary:

- `enforce`
- `warn`

### `plugins`

Controls packaged and custom plugin enablement plus plugin-specific settings such as:

- logger runtime behavior
- session runtime behavior
- process firewall integration

### `adapters`

Holds configuration for adapter-backed runtime components and services, including:

- `rpcRuntime`
- `ingressRuntime`
- `tenantDirectoryResolver`
- `tenantRegistryResolver`
- `tenantRouteMatcherCompiler`
- `requestUriRoutingRuntime`
- `middlewareStackRuntime`
- `processForkRuntime`
- `storageService`
- `sharedCacheService`
- `webServerService`

## Selected Adapter Sections

### `adapters.requestUriRoutingRuntime`

Controls route matching against the active tenancy registry, default app resolution, and route match caching behavior.

### `adapters.middlewareStackRuntime`

Controls middleware execution settings, input-size limits, queue behavior, and question names used by request execution.

### `adapters.processForkRuntime`

Controls supervised child-process boot paths, timeouts, and process coordination questions.

### `adapters.tenantDirectoryResolver`

Controls tenancy scan roots, scan cadence, registry refresh behavior, and forced rescan question names.

### `adapters.sharedCacheService`

Controls the shared-cache backend and operation-level failure policy.

## Notes

- The seccomp boundary for protected child processes blocks `fork`, `vfork`, `execve`, and `execveat`.
- Thread creation required by the Node.js runtime remains allowed.
- Seccomp and process identity are only part of the runtime security model; the bootstrap load policy and supported weak-load exceptions are documented in [Architecture](../core-concepts/architecture.md#load-policy) and [Runtime Logic Overview](../logic.md#load-policy).
- Direct CLI-triggered tenant rescans are handled by the `director` process through its local RPC socket.
