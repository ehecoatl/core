# Configuration

Ehecatl configuration is code-first. The runtime starts from `app/config/default.config.js` and then loads installation-specific JSON overrides from the external config directory.

## Load Order

The current loader behavior is:

1. load `app/config/default.config.js`,
2. read every `.json` file in `app.customConfigPath`,
3. replace matching top-level sections in the in-memory config object,
4. derive adapter lookup paths into `config._adapters`.

The default external config directory is:

```text
/etc/opt/ehecatl/config
```

## Important Detail: Section Replacement

Overrides are not deep-merged. Each JSON file replaces one top-level section by filename.

Examples:

- `networkEngine.json` replaces `config.networkEngine`
- `plugins.json` replaces `config.plugins`
- `processSupervisor.json` replaces `config.processSupervisor`

Unknown top-level filenames are skipped with a warning.

## Key Sections

### `app`

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

When enabled, runtime and error logs are written to hourly files partitioned by date/hour under the configured base directory, with max-file retention cleanup. The same plugin can also aggregate per-tenant request quality metrics in memory and periodically flush them to a tenant-local JSON report path (default `src/report.json`).

`tenantReport.relativePath` is normalized to stay under `src/`; if configured outside `src`, the writer automatically falls back to `src/<basename>`.

`plugins.process-firewall` applies per-process firewall setup and clear commands tied to supervisor lifecycle:

- `enabled`
- `contexts` (default `["MAIN"]`)
- `applyTo.manager`
- `applyTo.tenant`
- `applyTo.engine`
- `applyTo.otherNonEngine`
- `refreshAfterLaunch`
- `commandTimeoutMs`
- `failOnSetupError`
- optional `setupCommand` argv array
- optional `clearCommand` argv array

By default it runs before child-process launch, refreshes once after launch (to catch bound ports), and attaches cleanup so rules are cleared after process exit or launch rollback. The built-in defaults use runtime policy firewall commands (`firewall_setup` / `firewall_release`) and apply to non-engine child processes (manager and tenant).

### `rpc`

Controls the RPC adapter and ask or answer timeouts.

### `networkEngine`

Controls:

- transport adapter
- TLS key and certificate paths
- listen port
- rate-limiter settings
- question names used to reach manager services

### `tenancyRouter`

Controls:

- tenants base path
- route match cache TTL
- route miss cache TTL
- scan-active cache marker key and TTL used during rescans
- async timeout used for route-cache fire-and-forget writes
- optional proactive tenant-app reconciliation after scans (`spawnTenantAppAfterScan`)
- periodic scan interval
- periodic response-cache artifact cleanup interval

### `sessionRouter`

Controls in-memory and shared-cache session TTL values. Successful session cache reads refresh TTL in a sliding manner so active sessions stay warm without waiting for a write.

### `processSupervisor`

Controls:

- child-process adapter selection
- manager, engine, and tenant bootstrap paths
- number of concurrent engine processes
- graceful drain timeout before reload/shutdown escalation (`reloadDrainTimeoutMs`)
- heartbeat thresholds
- internal question names for reload and shutdown coordination
- optional question names for process reconciliation (`ensureProcess`, `listProcesses`, `processCounts`)

### `requestPipeline`

Controls the pipeline adapter, input size limits, queue overload policy, and question names used by queue and tenant-controller stages.

The default request-pipeline queue settings now include:

- `queue.perTenantMaxConcurrent`
- `queue.perSessionMaxConcurrent`
- `queue.staticMaxConcurrent`
- `queue.controllerMaxConcurrent`
- `queue.staticWaitTimeoutMs`
- `queue.controllerWaitTimeoutMs`
- `queue.waitTimeoutMs`
- `queue.sessionWaitTimeoutMs`
- `queue.retryAfterMs`
- `responseCacheAsyncTimeoutMs`
- `latencyClassification.enabled`
- `latencyClassification.profiles`
- `controllerRetryOnProcessRespawn.enabled`
- `controllerRetryOnProcessRespawn.maxAttempts`
- `controllerRetryOnProcessRespawn.methods`
- `controllerRetryOnProcessRespawn.retryDelayMs`
- `diskLimit.enabled`
- `diskLimit.defaultMaxBytes`
- `diskLimit.trackedPaths`
- `diskLimit.cleanupFirst`
- `diskLimit.cleanupTargetRatio`

These values control how many concurrent requests static/public-cache streams, controller routes, one tenant host, and one session can execute, how long queued requests can wait before timing out, the recommended retry window returned in overload responses, the async timeout budget for non-blocking response-cache materialization, profile-based request latency classification thresholds, one-shot retry behavior for idempotent controller requests after tenant-process transport failures, and soft tenant disk-limit enforcement for non-critical runtime writes.

Tenant hosts can override disk-limit policy in `src/config.json` with either:

- `diskLimitBytes` (number or size string, for example `"512MB"`), or
- `diskLimit` object (`enabled`, `maxBytes`, `trackedPaths`, `cleanupFirst`, `cleanupTargetRatio`).

### `storageService`

Selects the storage backend, which defaults to the bundled local filesystem adapter.

### `sharedCacheService`

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

Ehecatl does use environment variables, but mainly for runtime process behavior rather than full config replacement. Examples from the current code include:

- `PROCESS_LABEL`
- `PROCESS_USER`
- `PROCESS_GROUP`
- `NODE_ENV`

Runtime service lifecycle is managed by the installed `systemd` unit (`ehecatl.service`). The core config loader itself is not an `.env`-driven system.

## Recommended Override Strategy

- Keep `default.config.js` as the shipped baseline.
- Put installation-specific JSON under `/etc/opt/ehecatl/config`.
- Replace only the sections you truly need to customize.
- Store custom adapters and plugins outside the repository so upgrades stay simpler.
