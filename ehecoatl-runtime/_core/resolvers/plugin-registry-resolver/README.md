# Plugin Registry Resolver

## Purpose

Shared resolver that discovers plugin registry entries for a given kernel context before registration.

## Context

- Kernel contexts: `MAIN`, `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`
- Core file: `plugin-registry-resolver.js`
- Adapter-backed: no

## Current Behavior

- Resolves plugin registry entries from bundled plugins and an ordered list of optional custom plugin directories.
- Filters plugin loading by context name before `plugin-orchestrator` registration.
- Keeps scan order stable so later directories can override earlier ones when plugin override is explicitly allowed.

Current order used by the runtime is:

- bundled
- global custom
- tenant workspace, when the process has a tenant context
- isolated app plugins, when the process has both tenant and app context

## Ambiguities

- Effective plugin inventory depends on runtime config and filesystem state outside this directory.
- Override behavior is ultimately enforced by `plugin-orchestrator`, so plugin resolution and duplicate handling are intentionally split.

## Not Implemented Yet

- No obvious placeholder branch is visible here, but registry shape still depends on external plugin modules.
