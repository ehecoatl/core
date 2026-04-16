# Ehecatl Improvement Backlog - Done

## 1. Error Handling, Request Correctness And Guardrails

### 1.1 [DONE] Tenant-facing custom error message when `PROD=false`
Define a clearer, safer tenant-visible error response for non-production environments.

Implemented a centralized tenant-facing error-response helper based on `NODE_ENV`, using clearer non-production messages for tenant-controller transport failures and internal routing/pipeline failures, while preserving generic safe messages in production. Extended the non-production coverage to include diagnostic verbose responses for body-read normalization failures and static-asset misses, including short failure reasons and asset-path context where appropriate. Also fixed callback-time body parsing failures so thrown parse errors are normalized through the same response path. Added regression tests covering both non-production and production behavior.

### 1.2 [DONE] Request overload analysis
Analyze overload scenarios and define protection behavior such as throttling, queuing, rejection, and recovery.

Implemented a balanced overload policy for tenant-host request queueing. Added configurable request-pipeline queue settings for per-tenant concurrency, queue wait timeout, and recommended retry timing in the default config, with defaults of `1000ms` queue wait and `500ms` retry recommendation. Fixed the queue adapter so waiting requests now time out explicitly instead of hanging behind RPC timeouts, saturated queues return a controlled `503 Service Unavailable`, queue wait timeout returns `504 Gateway Timeout`, and overload responses include `Retry-After`. Hardened queue cleanup by tracking task ownership by process origin and releasing orphaned queue tasks through manager cleanup when an `engine_*` process exits unexpectedly. Added regression tests for queue saturation, queue wait timeout, queue-adapter cleanup by origin, and supervisor-triggered orphan cleanup.

### 1.3 [DONE] Error routes cache with TTL for early block
Add TTL-based caching for error-route decisions so repeated invalid requests can be blocked earlier.

Implemented a minimal negative route-cache strategy for confirmed route misses without expanding into broader error-response caching. Added a dedicated `routeMissTTL` configuration under `tenancyRouter`, defaulting to `5000ms`, and introduced `urlRouteMiss:<url>` handling in the engine-side manager resolver so repeated missing-route lookups can short-circuit before manager RPC. Kept the scope intentionally narrow to confirmed route-miss results only, avoiding transient failure caching. Added regression tests for negative cache write-back after a confirmed miss and for short-circuiting repeated misses from cache.

### 1.4 [DONE] Session data update after response writing
Verify whether session data can be safely updated after the response has already started or finished writing.

Verified the original behavior and changed the runtime flow so session persistence now happens before response writing, not after it. This strengthens the consistency contract by ensuring a successful client-visible response is no longer sent before session updates are stored. Added regression coverage to assert that session update hooks complete before response-write hooks begin.

### 1.5 [DONE] Invalid CSRF and request-admission validation
Validate CSRF and request-admission behavior so invalid requests are rejected deterministically.

Confirmed and preserved deterministic admission control across CSRF, method, and content-type validation. The body-read path now rejects structured CSRF failures correctly using the adapter's `{ success }` result instead of object truthiness, while request-admission checks continue returning explicit `405 Method Not Allowed` and `415 Unsupported Media Type` responses before body parsing or controller execution. Regression tests cover invalid CSRF rejection and request-admission failures.

### 1.6 [DONE] Preserve tenant-intended failure responses
Ensure tenant-generated `404`, `500`, and similar responses are preserved instead of being converted into generic gateway failures.

Kept and verified the tenant-controller failure contract so normalized tenant-provided failure responses are preserved across the engine boundary instead of being collapsed into generic `502 Bad Gateway` output. Tenant-provided failure `status`, `body`, headers, and cookies are now explicitly covered by regression tests, while generic gateway fallbacks remain reserved for true transport/no-response failure cases.

### 1.7 [DONE] Regression coverage for request-path failures
Add tests for missing controllers, invalid handlers, malformed request bodies, and similar failure scenarios.

Expanded regression coverage across the request-path failure matrix. Existing tests already covered invalid CSRF, malformed body parsing, request-admission failures, and tenant failure preservation. Added focused tenant-app controller-path tests for missing controller modules (`404 Controller not found`), invalid controller handlers (`500 Invalid controller handler`), and non-missing controller load failures (`500 Controller load failure`), keeping the tenant failure contract explicit and protected against regression.

---

## 2. Session, Cache And Consistency Management

### 2.1 [DONE] Execution-context metadata
Define execution-context metadata using boolean flags such as `session`, `cached`, and `controller`, plus timing metadata such as `bodyReadMs`, `responseWriteMs`, and controller execution details for request tracking, latency analysis, and diagnostics.

Implemented a dedicated `ExecutionMetaData` contract under the execution runtime folder and wired it into `ExecutionContext` and `StageContext` for stronger code organization and IntelliSense support. The runtime now tracks boolean flags for `session`, `cached`, and `controller`, records `bodyReadMs` and `responseWriteMs`, and attaches `controllerMeta` with `coldWaitMs` and `controllerMs` for tenant-controller executions. Added precise propagation for controller timing metadata through the internal RPC layer, including cold tenant-app spawn wait when applicable, and regression tests covering session metadata, cached-response reuse, body/response timing capture, stage-level controller metadata, and merged detailed RPC metadata.

### 2.2 [DONE] Live session vs cached session consistency
Review how live session updates and cached session state stay consistent.

Reworked the session flow so the request-owned session object is now treated as the source of truth for persistence instead of reloading and shallow-merging stale cache state. New session creation now allocates stable session and CSRF identity before persistence, stores the generated CSRF token inside the persisted session payload, and reuses that same identity when serializing response cookies. The engine-side session resolver now passes live session data into cookie serialization without rewriting cache again, and real shared-cache write failures are surfaced instead of being silently softened. Added regression coverage for new-session persistence without an incoming cookie, CSRF/session identity reuse, live session and response-cookie consistency, and hard cache-write failure behavior. Concurrent same-session writes are still effectively last-write-wins and remain better scoped for the dedicated race-condition item `2.5`.

### 2.3 [DONE] Cache invalidation rules
Define invalidation rules for session, route, and error caches.

Implemented explicit shared-cache invalidation primitives and aligned TTL behavior so cache semantics are no longer adapter-dependent. The shared cache service now supports exact-key deletion and prefix invalidation, the in-memory/file-style adapter now honors millisecond TTLs, and the Redis adapter now uses millisecond expiry instead of second-based drift. Successful tenancy scans now invalidate shared route-match, route-miss, and response-cache keys by prefix, stale `validResponseCache` pointers are deleted opportunistically when the cached artifact file is missing, and the manager now runs an asynchronous orphaned response-cache artifact cleanup cycle on a configurable interval through `tenancyRouter.responseCacheCleanupIntervalMs`. Session reads now refresh TTL in a sliding manner on cache hits, keeping active sessions warm without waiting for writes. Added regression coverage for shared-cache TTL expiration and prefix invalidation, tenancy-scan invalidation, stale response-cache pointer cleanup, orphaned artifact cleanup, and sliding session TTL on read.

### 2.4 [DONE] Cache behavior after tenant/config changes
Verify cache correctness after tenant rescans, host enable/disable changes, alias updates, and controller reloads.

Confirmed and regression-protected the tenant/config change behavior around scans and runtime refresh. Tenant scans now honor `hostEnabled: false` from each host `src/config.json`, ignore alias entries with `aliasEnabled: false`, and naturally stop resolving aliases that point to disabled or missing hosts because those hosts are excluded from the scanned tenant map. Successful rescans continue invalidating shared route and response-cache prefixes, and the manager selectively asks the main process to reload changed `tenant_*` processes or shut down removed/disabled ones instead of forcing a full tenant refresh. Reload detection now includes `src/config.json` and `src/app/index.js` modification-time changes so both config edits and tenant app entrypoint updates trigger a tenant reload on the next successful scan. Controller execution is also protected against stale code by reloading cached controller modules when the source-file modification time changes. Added regression coverage for disabled host and alias rules, alias-to-disabled-host behavior, selective tenant-process reload/shutdown after non-initial scans, scan-based reload triggers from config/entrypoint mtime changes, and controller hot-reload after source changes. Updated tenancy docs and adapter contract comments to reflect these rules.

### 2.5 [DONE] Cache race-condition analysis
Check for race conditions between cache reads/writes, concurrent requests, and supervisor respawns.

Implemented queue-broker and request-flow hardening focused on race-control behavior. The manager queue broker now forwards `waitTimeoutMs`, `maxWaiting`, and `origin` correctly (with backward compatibility for legacy `ttl` callers), preserving proper timeout behavior and origin-aware cleanup paths. Route-cache writes (`urlRouteData` / `urlRouteMiss`) now run as asynchronous fire-and-forget tasks with timeout-bounded error logging, and route-cache reads/writes are bypassed while tenancy scan is active through a shared `scanActiveCacheKey` marker to avoid stale scan-time cache races. Response-cache materialization was converted to asynchronous fire-and-forget with dedicated timeout and isolated logging, so request execution no longer blocks on cache artifact writes. Added a dedicated session queue stage with per-session concurrency control (`max 1` by default) and configurable wait timeout, serializing same-session controller execution to reduce concurrent session-write races. Session identity is now ensured before pipeline queueing so session-scoped queue labels are stable even on first-session requests. Added regression coverage for scan-active cache bypass, asynchronous cache write behavior compatibility, and session queue overload/serialization behavior.

### 2.6 [DONE] Local response cache TTL and validation rules
Verify the local response-cache TTL, the presence and handling of the `If-Modified-Since` header for cache revalidation, whether cached responses should return `304 Not Modified` or the already processed content, and whether the source files behind the cached artifact were modified after the cache was generated.

Implemented Option 1 with HTTP conditional revalidation for local cached artifacts. The local-file stream stage now reads `If-Modified-Since`, compares it with the cached artifact `mtime`, and returns `304 Not Modified` with `Last-Modified` when appropriate, otherwise returning the cached content normally while also setting `Last-Modified`. TTL behavior remains governed by the existing `validResponseCache` key expiry and no source-file freshness invalidation was added in this scope. Added regression tests for the `304` path and for `Last-Modified` emission when serving cached artifacts.

---

## 3. Tenant Runtime, Process Lifecycle And Restart Safety

### 3.1 [DONE] Spawn `TenantApp` after scan if missing
Automatically spawn `TenantApp` after scan when it should exist but is not running.

Implemented proactive tenant-app reconciliation after successful scans. The tenancy scan summary now includes `activeHosts` (`host` + `rootFolder`), and when `tenancyRouter.spawnTenantAppAfterScan` is enabled the manager asks main to `ensureProcess` for each active `tenant_<host>`, launching only missing processes (idempotent behavior). Added supervisor support for `ensureProcess` and `listProcesses` RPC questions used by this reconciliation flow, and updated configuration defaults to expose these question names.

### 3.2 [DONE] Clear tenant app state when host is missing or disabled
Clear tenant runtime state when the host is not found or when `config.json` has `HOST.ENABLED=false`.

Implemented shutdown of stale `tenant_*` processes that are running but no longer present in the latest active-host scan set (including disabled or removed hosts). After ensuring active hosts, manager now requests current process listing from main and issues `shutdownProcess` for tenant labels missing from `activeHosts`, keeping runtime tenant process state aligned with scan truth.

### 3.3 [DONE] Child-process kill behavior during supervisor respawn
Test child-process termination and cleanup behavior when the supervisor restarts or replaces processes.

Hardened supervisor reload kill semantics and expanded regression coverage. Reload now uses configurable timeouts for graceful exit (`processSupervisor.reloadGracefulExitTimeoutMs`) and a force-kill fail-safe (`processSupervisor.reloadForceKillFailSafeTimeoutMs`) so a stuck child cannot leave reload state locked forever. If a process still does not emit `exit` after force-kill, supervisor now clears reload-lock state, drops heartbeat tracking, and emits a terminal `dead` outcome (`reload_force_kill_no_exit`) for deterministic cleanup. Added dedicated tests validating both reload-relaunch failure paths and no-exit-after-kill fail-safe behavior.

### 3.4 [DONE] Child-process count visibility
Verify and monitor the number of spawned child processes, potentially through a supervisor logger plugin.

Implemented grouped child-process count visibility in supervisor runtime and logs. Process supervisor now exposes `getProcessCountsSnapshot()` with grouped totals (`manager`, `engine`, `tenant`, `other`, `total`) and serves this through RPC via a configurable `processCounts` question. Launch and exit hook payloads now include count snapshots before/after transitions, and `logger-runtime` now logs those count deltas on supervisor launch/exit events for operational monitoring. Added regression coverage for grouped counting and RPC exposure.

### 3.5 [DONE] In-flight request behavior during respawn
Confirm what happens to active requests when supervisor or child-process respawns occur.

Implemented bounded one-shot retry for in-flight tenant-controller transport failures on idempotent methods. The tenant-controller stage now supports a configurable retry policy (`requestPipeline.controllerRetryOnProcessRespawn`) and, when enabled, retries once for allowed methods (default `GET`/`HEAD`) after RPC transport failure likely caused by tenant process respawn or transient unavailability. Non-idempotent methods remain fail-fast by default to avoid duplicate side effects. Added regression tests covering successful retry on idempotent requests and explicit non-retry behavior for non-idempotent requests.

### 3.6 [DONE] Graceful restart and connection draining
Ensure restarts drain or terminate connections in a controlled way instead of cutting them abruptly.

Implemented supervisor-driven graceful draining before process exits. Added a new `drain` supervisor command path in boot lifecycle handling, with tenant-app drain support that blocks new controller requests (`503` while draining), waits for active in-flight controller executions to settle up to a bounded timeout, and then exits cleanly. Supervisor reload and shutdown flows now send `drain` (with timeout) instead of immediate `exit`, while existing force-kill fallbacks remain in place for non-cooperative processes. Added regression coverage ensuring reload and shutdown dispatch `drain` with timeout semantics.

### 3.7 [DONE] Partial runtime-state leftovers after reinstall flows
Check whether install, uninstall, clear, and rerun flows leave stale or partial runtime state behind.

Hardened setup and cleanup flows with explicit leftover-state handling and verification. `setup-ehecatl.sh` now performs pre-install stale-state cleanup (removing stale PM2 app entry, broken CLI symlink, and invalid install metadata), then runs a post-setup state verification to ensure CLI, project app path, and install metadata are all present. `uninstall-ehecatl.sh` and `purge-ehecatl-data.sh` now include post-operation verification steps that fail if expected artifacts were not fully removed (including lingering PM2 app registration). This makes partial-state leftovers visible and actionable during maintenance flows instead of silently carrying forward.

---

## 4. Observability, Logging And Operational Reporting

### 4.1 [DONE] Runtime and error logging by date and hour
Add runtime and error logs partitioned by date and hour, with configurable max retained files in logger plugins.

Implemented hourly file logging in `logger-runtime` with configurable retention. The plugin now supports `plugins.logger-runtime.fileLogging` config (`enabled`, `baseDir`, `maxFiles`, `cleanupIntervalMs`) and writes runtime and error lines into separate channel trees partitioned as `/<baseDir>/<channel>/YYYY-MM-DD/HH.log`. Added bounded file-retention cleanup by channel according to `maxFiles`, while preserving existing console output behavior. Added regression tests for hourly runtime/error file writes and max-file retention cleanup.

### 4.2 [DONE] Request latency classifications
Define latency thresholds and categories for request performance reporting.

Implemented config-driven request latency classification with route-profile awareness. Added `requestPipeline.latencyClassification` defaults and a classifier that categorizes request duration into `fast`, `ok`, `slow`, or `critical` using profile-specific thresholds (`staticAsset`, `cacheHit`, `controller`, `sessionController`, `default`). Classification is computed at request finalization and persisted in execution metadata (`latencyProfile`, `latencyClass`, `latencyThresholds`) for downstream reporting/analysis. Runtime logging now includes latency profile and class on engine request-complete events for operational visibility. Added regression tests for profile-based threshold behavior and execution-meta classification persistence.

### 4.3 [DONE] Tenant-level `report.json` for quality metrics
Persist latency and quality-compliance details in a tenant-host-level `report.json`, having a last-updated property for record.

Implemented an Option-2 async reporting model in `logger-runtime`: request-complete events now feed an in-memory per-tenant aggregator that is flushed periodically (configurable) to `src/report.json` under each tenant root. The report now tracks `windowStartedAt`, `lastUpdatedAt`, request totals, status-class distribution, latency profile/class distribution, and duration aggregates (`count`, `totalMs`, `avgMs`, `minMs`, `maxMs`) with a versioned metadata block for future compatibility. Added atomic JSON writes and flush-on-process-shutdown/dead hooks to reduce data-loss risk while keeping request execution non-blocking.

### 4.4 [DONE] Execution-context reporting
Improve observability so each request can be classified as `session`, `cold`, `body`, or `cached`.

Already completed under item `2.1 [DONE] Execution-context metadata`, where execution metadata flags and timing fields were defined and integrated for request-level classification and diagnostics.

### 4.5 [DONE] Correlation/request IDs across processes
Add request tracing across engine, manager, and tenant processes.

Implemented cross-process request correlation using `requestId`/`correlationId` propagation. The engine now resolves an incoming ID from `X-Request-Id` (or generates one when missing), stores it in request/execution metadata, and emits it back in response headers. RPC asks from engine to manager and tenant now carry this ID in `internalMeta`, and RPC answer merging preserves it alongside controller metadata, enabling end-to-end request tracing across engine, manager, and tenant process boundaries. Runtime request-complete logging now includes `requestId` for operational tracing.

---

## 5. Performance, Stability And Capacity

### 5.1 [DONE] Enterprise PM2 alternatives
Evaluate enterprise-grade alternatives to PM2 and compare performance, stability, and operational impact.

Implemented Option 2 by migrating packaged runtime supervision from PM2 to native `systemd` service management (`ehecatl.service`) while preserving the internal multi-process supervisor architecture. Added a systemd unit template and setup-time unit installation/enablement, updated installer checks to require `systemctl` instead of installing PM2, switched operational npm scripts to `systemctl`/`journalctl`, and extended uninstall/purge cleanup and verification to remove/validate both legacy PM2 entries and active systemd unit state.

### 5.2 [DONE] Load testing for memory, CPU, latency, and GC
Generate a repeatable load test focused on memory leaks, CPU consumption, latency, and garbage-collection behavior.

Implemented Option 2 as a multi-phase stability suite with a built-in runner at `app/scripts/perf-stability.js` and npm commands `perf:stability` and `perf:stability:quick`. The suite executes staged load phases (`warmup`, `steady`, `spike`, `soak`, `cooldown`) over route-profile mixes (`staticAsset`, `cacheHit`, `controller`, `sessionController`), records latency and error distributions, and samples runtime health periodically (RSS/heap/external memory, CPU percent, event-loop lag p99/max, ELU, GC counts and GC overhead percent). It writes timestamped normalized JSON reports into `report/performance/` with totals, per-profile latency summaries, per-phase results, runtime sample timelines, threshold-based pass/warn/fail checks, and next-action guidance for regression comparison and tuning.

### 5.6 [DONE] Request queue separation for static/cache vs controller paths
Check the feasibility of maintaining one request queue for local static-cache and public-asset stream access, and another queue for requests that require deeper validation stages, additional processing, and tenant-controller execution.

Implemented queue separation with dedicated host-scoped queue classes. Static/public asset streaming and local cached-artifact streaming now acquire `staticQueue:<host>` with separate concurrency/wait settings, while controller-bound requests use `controllerQueue:<host>` (plus existing session queue serialization when applicable). The default pipeline order now attempts local static/cache short-circuiting before controller queue admission, reducing contention between cheap stream paths and expensive controller paths. Added config knobs for static/controller queue limits and wait timeouts, updated overload diagnostics to identify queue class, and extended regression coverage for the new queue labeling and behavior.

---

## 6. Installation, Setup, Configuration And Upgrade Safety

### 6.1 [DONE] Stop install/setup if already installed
Verify whether `ehecatl install` and `setup` stop cleanly when the system is already installed.

Implemented Option 2 (safe stop by default with explicit override). `setup/setup-ehecatl.sh` now detects an existing valid installation and exits cleanly without applying changes unless `--force` is provided. `setup/bootstrap-system.sh` now mirrors this behavior when `/opt/ehecatl` already contains an existing checkout, exiting cleanly by default and forwarding `--force` to setup when reapplication is requested.

### 6.7 [DONE] Tenant disk-limit configuration
Check the possibility of supporting tenant disk-limit configuration, including how storage quotas are defined, enforced, and reported operationally.

Implemented soft tenant disk-limit enforcement for non-critical runtime writes in the response-cache materialization path. Added configurable policy under `requestPipeline.diskLimit` (enable flag, default max bytes, tracked paths, cleanup-first mode, cleanup target ratio), usage scanning across tracked tenant paths, cleanup of oldest tracked files when over limit, and write-skip behavior when limit remains exceeded to preserve request-path correctness.

### 6.8 [DONE] Per-tenant exclusive disk-limit rules
Verify whether disk limits can support exclusive per-tenant rules so each tenant can have its own isolated quota policy and enforcement behavior.

Covered by the same implementation as `6.7`: tenant hosts can now override disk-limit policy through host `src/config.json` using `diskLimitBytes` or a full `diskLimit` object (`enabled`, `maxBytes`, `trackedPaths`, `cleanupFirst`, `cleanupTargetRatio`), with per-tenant values taking precedence over global defaults.

### 6.9 [DONE] Clear dead code and unused environment variables
Review and remove obsolete system code paths and environment variables that are no longer used, keeping runtime behavior and configuration surfaces easier to maintain.

Completed an incremental low-risk cleanup pass for dead configuration surface and stale env usage. Removed unused runtime-policy proxy command mapping (`proxy` section and `getProxyCommandArgs`), removed the unused `proxyNetwork` top-level config section, and trimmed obsolete PM2-only environment variables from `app/ecosystem.config.js` (`DEFAULT_CONFIG`, `LOG_OUT_FILE`, `LOG_ERROR_FILE`, `ALLOW_HOST_VERSION_OVERRIDE`, `SERVER_OPTIONS_SSL_KEY`, `SERVER_OPTIONS_SSL_CERT`) while preserving `NODE_ENV`. Updated architecture/configuration/runtime-policy documentation to match the active isolation model and current env/config contract.

---

## 7. Security And Isolation

### 7.1 [DONE] Isolation of non-engine processes from HTTP traffic
Confirm that non-engine processes are isolated from incoming HTTP requests.

Implemented Option 3 with a dedicated `process-firewall` main-process plugin wired to supervisor lifecycle hooks. Before child launch, the plugin now applies firewall setup for configured non-engine process families (default: `manager` and `tenant`), refreshes setup once after launch, and attaches deterministic cleanup tasks so firewall rules are cleared after process exit and on launch rollback/failure paths. The plugin is configurable via `plugins.process-firewall` (target families, post-launch refresh toggle, command timeout, strict setup-failure behavior, and optional custom setup/clear command argv), and now defaults to runtime policy firewall commands (`firewall_setup` / `firewall_release`) instead of proxy commands. Added regression tests covering setup-before-launch, cleanup clear, and engine-skip behavior.

---

## 8. Dependency Failure And Degraded-Mode Behavior

### 8.1 [DONE] Redis/shared-cache failure behavior
Define behavior when Redis or the shared-cache layer becomes slow, unavailable, or inconsistent.

Implemented Option 1 with explicit fail-open policy and warning visibility in shared-cache gateway operations. `get` failures now log structured warnings and return the provided default value (cache miss behavior), while write/delete/list-style operations use configurable fail-open fallbacks with warnings (`set/delete/deleteByPrefix/has/appendList/getList`). Added default `sharedCacheService.failurePolicy` config entries for each operation. To preserve correctness for session persistence, session cache writes now treat explicit fail-open `false` cache-set results as persistence failure, preserving deterministic session-write error behavior. Added regression tests covering fail-open get logging, fail-open set logging, and session persistence rejection when cache set reports failure.

### 8.2 [DONE] Malformed or partial tenant configuration
Define behavior when tenant configuration is invalid, incomplete, or corrupted.

Implemented Option 1 (strict fail-fast per host, scan-resilient globally). During tenancy scan, malformed domain/host config JSON now invalidates only the affected host(s), excludes them from routing/process activation, and continues scanning other hosts. For visibility at tenant source level, scanner now writes a structured error artifact to `src/config.validation.error.json` inside the affected host folder (including host, scope, paths, timestamp, and normalized error details). When a host validates successfully again, this error file is removed. Added regression coverage for malformed host config isolation, continued healthy-host routing, and host-level error-file emission.
