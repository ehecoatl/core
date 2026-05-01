# Retention and Cleanup Policy

This design topic is important because Ehecoatl exposes caches, logs, spools, and backup-like support folders without a packaged retention and pruning model.

## Gap

- Runtime support folders exist, but no first-class retention policy governs their growth and cleanup.
- Cleanup today is mostly destructive or manual, through uninstall and purge, rather than incremental hygiene tooling.
- Operators therefore need local conventions for log, cache, and spool management.

## What A First-Class Experience Would Add

- Retention rules for logs, cache, spool, and backup-like runtime surfaces.
- Packaged cleanup commands or recurring maintenance hooks.
- Operator visibility into what can be pruned safely and what should be retained.

## Current Related Surfaces

- [`docs/core-concepts/tenancy.md`](../../core-concepts/tenancy.md)
- [`docs/reference/runtime-policy.md`](../../reference/runtime-policy.md)
- `setup/uninstall/purge-data.sh`

## Risk

- Without retention tooling, runtime state can accumulate without clear product-backed hygiene rules.
