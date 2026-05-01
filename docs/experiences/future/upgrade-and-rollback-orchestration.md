# Upgrade and Rollback Orchestration

This design topic is important because Ehecoatl has install and cleanup flows, but not a first-class packaged experience for upgrading and safely rolling back runtime versions.

## Gap

- Operators can install and remove the runtime, but there is no structured upgrade path with rollback semantics.
- The repository does not present a packaged staged migration or compatibility workflow.
- Version change management is therefore more manual than the rest of the runtime lifecycle suggests.

## What A First-Class Experience Would Add

- A packaged upgrade command or workflow that preserves state and validates compatibility.
- Rollback guidance or automation for failed upgrades.
- Clear runtime/version metadata and operator feedback around upgrade state.

## Current Related Surfaces

- [`docs/getting-started.md`](../../getting-started.md)
- `setup/bootstrap.sh`
- `setup/uninstall.sh`

## Risk

- Mature install and teardown flows create the expectation that controlled upgrades are equally productized, which is not true today.
