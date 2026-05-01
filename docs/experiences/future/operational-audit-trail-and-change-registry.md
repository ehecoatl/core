# Operational Audit Trail and Change Registry

This design topic is important because Ehecoatl currently performs meaningful administrative actions without a first-class audit surface that records who changed what, when, and why.

## Gap

- Deploys, rescans, login creation and deletion, enable and disable actions, uninstall, and purge do not currently produce a packaged audit record.
- Operators can inspect logs and host history, but those are not the same as a structured runtime change registry.
- This weakens accountability and incident reconstruction in a product that already emphasizes isolation and controlled operational surfaces.

## What A First-Class Experience Would Add

- Structured records for administrative actions with actor, scope, target, timestamp, and outcome.
- A stable storage surface for change history that survives normal process restarts.
- Packaged CLI or report surfaces to inspect recent change history without depending on raw host logs.

## Current Related Surfaces

- [`docs/reference/cli.md`](../../reference/cli.md)
- `ehecoatl-runtime/cli/ehecoatl.sh`
- `setup/uninstall.sh`

## Risk

- Without a packaged audit trail, operational trust depends too heavily on shell history, service logs, and human memory.
