# Request Lifecycle

This page describes the current HTTP path implemented by the bundled `uws` HTTP adapter and the default middleware stack orchestrator.

## 1. Network Acceptance

A transport process starts the configured ingress runtime adapter. By default, `ingressRuntime.adapter` is `uws`, which binds an SSL listener and accepts:

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

Session-aware request execution now runs through the built-in `session-runtime` plugin after the transport process has normalized the request envelope.

## 3. Body Parsing and CSRF Check

Before body parsing, the HTTP adapter can reject requests that violate app-level `methodsAvailable`, per-route `methods`, or per-route `contentTypes` policy.

For `POST`, `PATCH`, `PUT`, and `DELETE`, the `uws` body reader:

- lets the `session-runtime` plugin validate CSRF before body parsing continues,
- enforces `maxInputBytes`,
- parses JSON and URL-encoded bodies,
- supports multipart upload streaming.

The size limit comes from `tenantRoute.maxInputBytes` when present, otherwise from `middlewareStackOrchestrator.maxInputBytes`.

## 4. Tenant Resolution

The transport process asks the director process to resolve the current URL through the tenant route runtime. The tenant directory resolver and tenant route runtime together:

- scans the tenants filesystem,
- caches hostname matches and confirmed route misses for short TTLs,
- resolves aliases when configured,
- normalizes `pointsTo` route targets into runtime route metadata,
- compiles dynamic route patterns,
- returns route metadata that becomes a `TenantRoute`.

## 5. Middleware Stack Execution

The default HTTP middleware order is:

1. `static-asset-serve-middleware`
2. `response-cache-resolver-middleware`
3. `mid-queue-middleware`
4. `tenant-action-middleware`
5. `response-cache-materialization-middleware`

### `mid-queue-middleware`

Queues action-bound requests per tenant hostname through the director queue manager. This limits concurrency for the same hostname label without forcing static-asset or response-cache streaming to wait behind action work.

### `static-asset-serve-middleware`

Attempts fast-path delivery for static assets mapped by the tenant route.

This middleware acquires a dedicated static queue per hostname, can serve cached action artifacts directly from disk, and supports `If-Modified-Since` revalidation with `304 Not Modified` plus `Last-Modified` when the cached artifact has not changed.

### `response-cache-resolver-middleware`

Attempts fast-path delivery for cached response files when route caching is enabled.

This middleware checks the shared response-cache pointer, streams the cached artifact through the same static queue used for asset delivery, and coordinates cache production with a single-producer queue keyed by `validResponseCache:<url>`.

### `tenant-action-middleware`

If the route defines an action, the transport process asks the canonical `e_app_{tenant_id}_{app_id}` isolated runtime process to execute it. The tenant response can set:

- `status`
- `headers`
- `cookie`
- `body`

Tenant-intended failure responses such as `404` and `500` are preserved across the RPC boundary. A `502` fallback is reserved for transport-level action failure or missing action response.

### `response-cache-materialization-middleware`

For cacheable action responses, the transport process can write a response-cache artifact asynchronously after the response payload is already available. This materialization path is intentionally non-blocking for the client response and respects tenant disk-limit policy.

## 6. Response Finalization

After middleware-stack execution, the transport process:

- lets the `session-runtime` plugin persist updated session data and merge response cookies when the route enables sessions,
- serializes headers and cookies,
- writes the body as a stream, buffer, object, string, or empty response.

Objects are serialized as JSON automatically.

## 7. Finish Callbacks

Transport middlewares can register finish callbacks. Ehecoatl uses this for cleanup work such as queue release after the response path completes. Non-critical cache work can also run as asynchronous side tasks so cache materialization and cache-write failures do not extend client response latency.

## 8. Hooks Around the Flow

Hooks wrap most of the lifecycle:

- request start, end, break, and error,
- request body lifecycle,
- per-middleware lifecycle,
- response write lifecycle,
- RPC send and receive,
- storage and cache operations.

That means a large part of the lifecycle can be observed or extended without patching the core runtime classes directly.

## WebSocket Notes

WebSocket handling exists, but it is much thinner than the HTTP path:

- upgrades and messages are accepted by the `uws` adapter,
- a WebSocket limiter is applied,
- the default WebSocket middleware-stack surface is minimal.

Treat the HTTP lifecycle as the primary documented behavior in the current Ehecoatl code.

Tenant/app middleware is a separate layer from the transport middleware stack. Transport middleware runs before the request reaches tenant action execution, while tenant/app middleware remains tenant-defined route metadata and extension structure.
