# Abuse Control and Capacity Governance

This design topic is important because Ehecoatl isolates processes and scopes topology, but does not yet expose rate limits, quotas, or capacity governance as a first-class operational experience.

The runtime does include lower-level request limiting and queue coordination today:

- HTTP ingress applies a per-client-IP token bucket before route resolution.
- App action execution is guarded by a director-side in-memory queue per tenant host.
- Explicit response-cache materialization serializes cache misses per cache key.

Those mechanisms protect specific runtime paths, but they are not yet exposed as a complete operator-facing capacity-governance product surface.

## Gap

- The product does not present tenant or app resource budgets as a packaged control surface.
- There is no first-class operator experience for rate limiting, abuse throttling, or storage-budget governance.
- Disk-limit tracked paths are app-root-relative runtime support paths, and enforcement is currently tied to response-cache materialization.
- Static asset queue settings exist in default configuration, but static asset handling does not currently consume `staticMaxConcurrent` or `staticWaitTimeoutMs`.
- The shipped queue broker is in-memory inside `director`; it is not a durable or distributed queue backend.
- Current request-security and isolation features therefore stop short of broader capacity management.

## What A First-Class Experience Would Add

- Rate-limit and quota controls tied to tenant, app, or route surfaces.
- Operator visibility into resource pressure and policy breaches.
- A clearer bridge between isolation policy and capacity policy.

## Current Related Surfaces

- [`docs/reference/configuration.md`](../../reference/configuration.md)
- [`docs/experiences/request-security-composition.md`](../extension/request-security-composition.md)
- [`docs/experiences/process-isolation-and-identity-model.md`](../nucleus/process-isolation-and-identity-model.md)

## Risk

- Isolation alone does not provide the same operational protection as explicit abuse and capacity controls.
