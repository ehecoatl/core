# Plugin Orchestrator

## Purpose

Shared orchestrator use case that registers plugins, scopes hook access by process context, and runs listeners in priority order.

## Context

- Kernel contexts: `MAIN`, `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`
- Core file: `plugin-orchestrator.js`
- Adapter-backed: no

## Current Behavior

- Activates one hook namespace at a time with shared-hook access.
- Registers plugins, unloads them, and runs teardown on replacement or destroy.
- Executes hooks through `run` and `runWithContext`.

## Ambiguities

- Hook availability depends on `plugin-hooks.config.js`, so behavior is partly defined outside this directory.
- The README can confirm lifecycle behavior, but exact hook coverage still depends on the active plugin set and context configuration.

## Not Implemented Yet

- Nothing obviously stubbed in this directory, but plugin outcomes remain dependent on external plugin implementations.
