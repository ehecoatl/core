# RPC Runtime

## Purpose

Shared process-to-process endpoint for question/answer messaging, timeouts, and hook-aware transport dispatch.

## Context

- Kernel contexts: `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`
- Core files: `rpc-runtime.js`, `rpc-channel.js`, `rpc-resolver.js`
- Adapter-backed: yes
- Default adapter: `ipc`

## Current Behavior

- Sends questions, tracks pending answers, and resolves them with timeouts.
- Registers question listeners and returns structured error answers when a listener is missing.
- Uses `rpc-resolver.js` as the main-process router and `ipc` as the bundled transport adapter.

## Ambiguities

- The supervisor-side routing layer and the per-process runtime share the same subsystem but live in separate files, so responsibilities are intentionally split.
- Delivery can fall back to loopback routing when adapter transport does not deliver directly.

## Not Implemented Yet

- Additional bundled RPC transports beyond `ipc` are not implemented in this repo snapshot.
