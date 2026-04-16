# Configuration

Ehecoatl configuration is code-first. The runtime starts from `ehecoatl-runtime/config/default.config.js` and then loads installation-specific JSON overrides from the external config directory.

## Load Order

The current loader behavior is:

1. load `ehecoatl-runtime/config/default.config.js`,
2. read every `.json` file in `runtime.customConfigPath`,
3. replace matching top-level sections in the in-memory config object,
4. derive adapter lookup paths into `config._adapters`.

The default external config directory is:

```text
/etc/opt/ehecoatl/config
```

## Important Detail: Section Replacement

Overrides are not deep-merged. Each JSON file replaces one top-level section by filename.

Examples:

- `runtime.json` replaces `config.runtime`
- `plugins.json` replaces `config.plugins`
- `adapters.json` replaces `config.adapters`

Unknown top-level filenames are skipped with a warning.

## Key Sections

### `runtime`

Defines the external directories for:

- custom config
- custom adapters
- custom plugins

### `plugins`

Controls plugin enablement and may also carry plugin-specific options.

`plugins.logger-runtime` now supports hourly file-logging options:

- `fileLogging.enabled`
- `fileLogging.baseDir`
- `fileLogging.maxFiles`
- `fileLogging.cleanupIntervalMs`
- `tenantReport.enabled`
- `tenantReport.relativePath`
- `tenantReport.flushIntervalMs`

When enabled, runtime and error logs are written to hourly files partitioned by date/hour under the configured base directory, with max-file retention cleanup. The same plugin can also aggregate per-tenant request quality metrics in memory and periodically flush them to a tenant-local JSON report path (default `.ehecoatl/.log/report.json`).

`tenantReport.relativePath` is normalized to stay under `.ehecoatl/.log/`; if configured outside that tree, the writer automatically falls back to `.ehecoatl/.log/<basename>`.

`plugins.process-firewall` applies per-process firewall setup and clear commands tied to supervisor lifecycle:

- `enabled`
- `contexts` (default `["MAIN"]`)
- `applyTo.director`
- `applyTo.isolatedRuntime`
- `applyTo.transport`
- `applyTo.otherNonEngine`
- `refreshAfterLaunch`
- `commandTimeoutMs`
- `failOnSetupError`
- optional `setupCommand` argv array
- optional `clearCommand` argv array

By default it runs before child-process launch, refreshes once after launch (to catch bound ports), and attaches cleanup so rules are cleared after process exit or launch rollback. The built-in defaults use the active CLI firewall entrypoints from runtime policy, currently `ehecoatl firewall newtork_wan_block on ...` and `ehecoatl firewall newtork_wan_block off ...`, and apply to the selected child processes such as director and tenant.

These firewall commands are intended to be deterministic single-purpose shell scripts used only for network isolation updates. They are not meant to be a general privileged scripting surface.

The privilege model is intentionally narrow:

- the launcher path keeps `CAP_NET_ADMIN`
- `bootstrap-main` drops `CAP_NET_ADMIN` before continuing boot
- forked runtime processes do not retain `CAP_NET_ADMIN`

This keeps network administration inaccessible to bundled or custom third-party runtime scripts.

`plugins.session-runtime` now owns session and CSRF behavior:

- `enabled`
- `contexts` (default `["TRANSPORT", "FLOW"]`)
- `cacheTTL`
- `path`

The official configuration lives only under `plugins.session-runtime`.

### `adapters`

All runtime component and adapter-backed use-case configuration now lives under `adapters`.

Examples:

- `adapters.rpcRuntime`
- `adapters.ingressRuntime`
- `adapters.tenantDirectoryResolver`
- `adapters.processForkRuntime`
- `adapters.sharedCacheService`

### `adapters.rpcRuntime`

Controls the RPC adapter and ask or answer timeouts.

### `adapters.ingressRuntime`

Controls:

- transport adapter
- TLS key and certificate paths
- listen port
- rate-limiter settings
- question names used to reach director services

### `adapters.tenantDirectoryResolver`

Controls:

- tenants base path
- source internal tenants path used during tenancy scans
- scan-active cache marker key and TTL used during rescans
- optional proactive tenant-app reconciliation after scans (`spawnTenantAppAfterScan`)
- periodic scan interval
- periodic response-cache artifact cleanup interval

### `adapters.tenantRegistryResolver`

Controls:

- adapter selection for persisting the active tenancy registry into the runtime registry tree
- the persistence strategy used to mirror `tenant_<id>/app_<id>` folders under the runtime registry path
- the shape of the persisted `config.json` snapshots generated from normalized app config and merged routes

### `adapters.tenantRouteMatcherCompiler`

Controls:

- adapter selection for route normalization and first-match comparer compilation from merged tenant route config
- nested prefix-group expansion behavior defined by the active adapter

### `adapters.requestUriRouteResolver`

Controls:

- adapter selection for route matching against the active tenant registry
- global default app name used when a domain does not override it (`www` by default)
- route match cache TTL
- route miss cache TTL
- async timeout used for route-cache fire-and-forget writes

Each tenant domain may also define `tenants/{domain}/config.json` with:

- `appRouting.mode`: `subdomain` or `path`
- `appRouting.defaultAppName`: per-domain override for the global default

### `adapters.watchdogOrchestrator`

Controls:

- heartbeat timeout and ELU/lag thresholds
- graceful drain timeout before reload escalation (`reloadDrainTimeoutMs`)
- graceful-exit and force-kill reload fail-safe timers
- internal question names for heartbeat and reload coordination

### `adapters.processForkRuntime`

Controls:

- child-process adapter selection
- director, transport, and isolated-runtime bootstrap paths
- number of concurrent transport processes
- default shutdown timeout for coordinated child exits
- internal question names for shutdown coordination
- optional question names for process reconciliation (`ensureProcess`, `listProcesses`, `processCounts`)

### `adapters.webServerService`

Controls:

- adapter selection for director-managed ingress server setup
- director-side registry update propagation for active tenant hostnames and domain aliases

### `adapters.middlewareStackOrchestrator`

Controls the middleware-stack adapter, input size limits, queue overload policy, and question names used by queue and tenant-action middleware.

The default middleware-stack-orchestrator queue settings now include:

- `queue.perTenantMaxConcurrent`
- `queue.staticMaxConcurrent`
- `queue.actionMaxConcurrent`
- `queue.staticWaitTimeoutMs`
- `queue.actionWaitTimeoutMs`
- `queue.waitTimeoutMs`
- `queue.retryAfterMs`
- `responseCacheAsyncTimeoutMs`
- `latencyClassification.enabled`
- `latencyClassification.profiles`
- `actionRetryOnProcessRespawn.enabled`
- `actionRetryOnProcessRespawn.maxAttempts`
- `actionRetryOnProcessRespawn.methods`
- `actionRetryOnProcessRespawn.retryDelayMs`
- `diskLimit.enabled`
- `diskLimit.defaultMaxBytes`
- `diskLimit.trackedPaths`
- `diskLimit.cleanupFirst`
- `diskLimit.cleanupTargetRatio`

These values control how many concurrent requests static-asset streams, action routes, and one tenant hostname can execute, how long queued requests can wait before timing out, the recommended retry window returned in overload responses, the async timeout budget for non-blocking response-cache materialization, profile-based request latency classification thresholds, one-shot retry behavior for idempotent action requests after tenant-process transport failures, and soft tenant disk-limit enforcement for non-critical runtime writes.

Tenant apps can override disk-limit policy in `config.json` with either:

- `diskLimitBytes` (number or size string, for example `"512MB"`), or
- `diskLimit` object (`enabled`, `maxBytes`, `trackedPaths`, `cleanupFirst`, `cleanupTargetRatio`).

### `adapters.storageService`

Selects the storage backend, which defaults to the bundled local filesystem adapter.

### `adapters.sharedCacheService`

Selects the shared-cache backend. The default config points to `redis`.

The shared-cache failure policy is configurable per operation and defaults to fail-open with warnings:

- `failurePolicy.get.failOpen` / `failurePolicy.get.warn`
- `failurePolicy.set.failOpen` / `failurePolicy.set.warn`
- `failurePolicy.delete.failOpen` / `failurePolicy.delete.warn`
- `failurePolicy.deleteByPrefix.failOpen` / `failurePolicy.deleteByPrefix.warn`
- `failurePolicy.has.failOpen` / `failurePolicy.has.warn`
- `failurePolicy.appendList.failOpen` / `failurePolicy.appendList.warn`
- `failurePolicy.getList.failOpen` / `failurePolicy.getList.warn`

## Environment Variables

Ehecoatl does use environment variables, but mainly for runtime process behavior rather than full config replacement. Examples from the current code include:

- `PROCESS_LABEL`
- `PROCESS_USER`
- `PROCESS_GROUP`
- `PROCESS_SECOND_GROUP`
- `NODE_ENV`

Runtime service lifecycle is managed by the installed `systemd` unit (`ehecoatl.service`). The core config loader itself is not an `.env`-driven system.

## Recommended Override Strategy

- Keep `default.config.js` as the shipped baseline.
- Put installation-specific JSON under `/etc/opt/ehecoatl/config`.
- Replace only the sections you truly need to customize.
- Store custom adapters and plugins outside the repository so upgrades stay simpler.
