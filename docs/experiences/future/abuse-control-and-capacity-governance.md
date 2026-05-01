# Abuse Control and Capacity Governance

This design topic is important because Ehecoatl isolates processes and scopes topology, but does not yet expose rate limits, quotas, or capacity governance as a first-class operational experience.

## Gap

- The product does not present tenant or app resource budgets as a packaged control surface.
- There is no first-class operator experience for rate limiting, abuse throttling, or storage-budget governance.
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
