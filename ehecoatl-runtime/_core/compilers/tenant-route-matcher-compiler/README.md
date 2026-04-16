# Tenant Route Matcher Compiler

## Purpose

Director-side compiler that normalizes tenant route definitions and compiles first-match comparers for later request-time lookup.

## Context

- Kernel context: `DIRECTOR`
- Core file: `tenant-route-matcher-compiler.js`
- Adapter-backed: yes
- Default adapter: `default-routing-v1`

## Current Behavior

- Delegates route normalization and compilation to the configured adapter.
- Produces flattened `routesAvailable` output plus `compiledRoutes` for fast first-match lookup.

## Ambiguities

- Actual route-shape rules live mostly in the adapter and `tenant-route-meta`, so this compiler is intentionally thin.
- The repo only shows one route compiler version, so versioning is structural rather than actively pluggable today.

## Not Implemented Yet

- Additional bundled routing versions beyond `default-routing-v1` are not implemented in this repo snapshot.
