# Request Lifecycle

This page describes the current HTTP request path implemented by the packaged ingress runtime and middleware stack.

## 1. Network Acceptance

The tenant transport process accepts HTTP requests through the configured ingress adapter. In the default packaged flow, that adapter is the UWS runtime.

Before the request reaches application code, the transport process:

- resolves the client address
- applies request limiting
- builds an `ExecutionContext`

## 2. Request Normalization

The execution context builds normalized request data including:

- method
- path
- headers
- query string
- parsed cookies
- request body
- client IP

The request path is normalized before route matching, including canonical slash handling.

## 3. Route Resolution

The transport process asks `director` to resolve the active route through `requestUriRoutingRuntime`.

That resolution step uses the active tenancy registry maintained by `tenantDirectoryResolver` and returns a normalized `TenantRoute` model.

## 4. Middleware Execution

HTTP middleware execution is coordinated by `middlewareStackRuntime`.

The packaged transport flow includes middleware for:

- static asset delivery
- response-cache lookup
- queue coordination
- tenant action execution
- asynchronous cache materialization

Tenant and app middleware remain separate from core transport middleware. They are represented in route metadata and tenant-local middleware files.

Tenant and app middleware are one of the few intentional runtime weak-load surfaces. They are loaded from absolute file paths through `weakRequire`, which compares source-file modification time, clears stale `require.cache` state when the file changes or disappears, and reloads on the next stack build. This exception exists for deployment-facing extension code only; it does not extend to arbitrary core runtime files. See [Architecture](architecture.md#load-policy) for the canonical load-policy rule.

## 5. Action Execution

When the route points to an app action, the transport process sends the request to the canonical `e_app_{tenant_id}_{app_id}` isolated runtime process for that application.

The isolated runtime executes the action and returns the response payload back to transport.

The isolated runtime also weak-loads the app entrypoint and action modules by design. Those files are reloaded through `weakRequire` when their source modification time changes, and stale exports are not preserved after a changed-file load failure.

## 6. Response Writing

After middleware execution completes, the transport process writes:

- status
- headers
- cookies
- body

Objects are serialized as JSON automatically. Streamed and cached responses are also finalized in the transport process.

## 7. WebSocket Upgrade Path

WebSocket upgrades now follow the same request bootstrap principles up to the upgrade decision:

- build execution context
- normalize request data
- resolve the route first
- run the dedicated WebSocket upgrade middleware path

If the final response status is `200`, the transport performs the upgrade. Otherwise it returns a normal HTTP rejection response.

Live channel coordination after upgrade is handled by `wsHubManager`, while isolated apps interact through `services.ws` backed by `wsAppRuntime`.
