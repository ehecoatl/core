# Request Lifecycle

This page describes the current HTTP path implemented by the bundled `uws` network adapter and the default request pipeline.

## 1. Network Acceptance

An engine process starts the configured network adapter. By default, `networkEngine.adapter` is `uws`, which binds an SSL listener and accepts:

- HTTP requests through `app.any("/*", ...)`
- WebSocket upgrades through `app.ws("/*", ...)`

Before the request is handled, the adapter:

- resolves the client IP from forwarded headers or the socket,
- applies a token-bucket limiter,
- creates an `ExecutionContext`.

## 2. Request Normalization

The execution context builds a `RequestData` object containing:

- method,
- URL,
- headers,
- query string,
- parsed cookies,
- request body,
- client IP.

If a `session` cookie already exists, the engine loads session data through its own session router before the pipeline runs.

## 3. Body Parsing and CSRF Check

Before body parsing, the HTTP adapter can reject requests that violate host-level `methodsAvailable`, per-route `methods`, or per-route `"content-types"` policy.

For `POST`, `PATCH`, `PUT`, and `DELETE`, the `uws` body reader:

- validates CSRF through the engine session router,
- enforces `maxInputBytes`,
- parses JSON and URL-encoded bodies,
- supports multipart upload streaming.

The size limit comes from `tenantRoute.maxInputBytes` when present, otherwise from `requestPipeline.maxInputBytes`.

## 4. Tenant Resolution

The engine asks the manager process to resolve the current URL through the tenancy router. The tenancy router:

- scans the tenants filesystem,
- caches host matches and confirmed route misses for short TTLs,
- resolves aliases when configured,
- compiles dynamic route patterns,
- returns route metadata that becomes a `TenantRoute`.

## 5. Pipeline Execution

The default HTTP stage order is:

1. `local-file-stream-stage`
2. `mid-queue-stage`
3. `mid-session-queue-stage`
4. `tenant-controller-stage`
5. `response-cache-materialization-stage`

### `mid-queue-stage`

Queues controller-bound requests per tenant host through the manager queue broker. This limits concurrency for the same host label without forcing static/public-cache streaming to wait behind controller work.

### `local-file-stream-stage`

Attempts fast-path delivery for:

- static assets mapped by the tenant route,
- cached response files when route caching is enabled.

This stage acquires a dedicated static queue per host, can serve cached controller artifacts directly from disk, and supports `If-Modified-Since` revalidation with `304 Not Modified` plus `Last-Modified` when the cached artifact has not changed.

### `mid-session-queue-stage`

When the route uses sessions, this stage serializes same-session controller execution through a dedicated queue label so concurrent requests for one session do not race on session mutation.

### `tenant-controller-stage`

If the route defines a controller, the engine asks a tenant process to execute it. The tenant response can set:

- `status`
- `headers`
- `cookie`
- `body`

Tenant-intended failure responses such as `404` and `500` are preserved across the engine boundary. A `502` fallback is reserved for transport-level controller failure or missing controller response.

### `response-cache-materialization-stage`

For cacheable controller responses, the engine can write a response-cache artifact asynchronously after the response payload is already available. This materialization path is intentionally non-blocking for the client response and respects tenant disk-limit policy.

## 6. Response Finalization

After pipeline execution, the engine:

- optionally generates response cookies when the route enables sessions,
- persists updated session data through its own session router before response writing,
- serializes headers and cookies,
- writes the body as a stream, buffer, object, string, or empty response.

Objects are serialized as JSON automatically.

## 7. Finish Callbacks

Pipeline stages can register finish callbacks. Ehecatl uses this for cleanup work such as queue release after the response path completes. Non-critical cache work can also run as asynchronous side tasks so cache materialization and cache-write failures do not extend client response latency.

## 8. Hooks Around the Flow

Hooks wrap most of the lifecycle:

- request start, end, break, and error,
- request body lifecycle,
- per-stage lifecycle,
- response write lifecycle,
- RPC send and receive,
- storage and cache operations.

That means a large part of the lifecycle can be observed or extended without patching the core gateway classes directly.

## WebSocket Notes

WebSocket handling exists, but it is much thinner than the HTTP path:

- upgrades and messages are accepted by the `uws` adapter,
- a WebSocket limiter is applied,
- the default WebSocket pipeline surface is minimal.

Treat the HTTP lifecycle as the primary documented behavior in the current Ehecatl code.
