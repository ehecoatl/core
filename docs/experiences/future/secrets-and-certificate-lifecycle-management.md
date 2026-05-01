# Secrets and Certificate Lifecycle Management

This design topic is important because Ehecoatl can integrate with edge services, but it does not yet provide a first-class experience for tracking, rotating, and monitoring secrets and certificates.

## Gap

- Optional host bootstraps exist for Let's Encrypt and related edge components, but not a broader lifecycle-management surface.
- The runtime does not expose certificate renewal visibility, secret rotation flows, or packaged failure monitoring for those assets.
- Sensitive operational material is therefore only partially represented in the current product model.

## What A First-Class Experience Would Add

- Clear ownership and lifecycle records for certificates and secrets.
- Renewal visibility and failure surfaces for certificate operations.
- Rotation and update procedures that fit the same packaged operational style as install and deploy.

## Current Related Surfaces

- `setup/bootstraps/README.md`
- [`docs/reference/setup-and-maintenance.md`](../../reference/setup-and-maintenance.md)
- [`docs/reference/runtime-policy.md`](../../reference/runtime-policy.md)

## Risk

- Edge integration exists, but the sensitive lifecycle around it remains under-documented and under-tooled.
