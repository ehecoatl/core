# Web Socket Manager

## Purpose

Tenant runtime manager use case for tracking websocket clients, metadata, and message events.

## Context

- Kernel context: `ISOLATED_RUNTIME`
- Core file: `web-socket-manager.js`
- Adapter-backed: yes
- Default adapter: `local-memory`

## Current Behavior

- Registers, unregisters, lists, and looks up clients by `clientId`.
- Supports metadata updates plus `sendMessage`, `broadcastMessage`, and synthetic `receiveMessage`.
- Exposes listener registration through `onMessage` and `offMessage`.

## Ambiguities

- The bundled adapter is an in-memory registry and event emitter; the repo does not show a real network socket binding layer here.
- Message delivery currently looks like runtime bookkeeping plus event fanout, not a transport to remote clients by itself.

## Not Implemented Yet

- Cluster-wide websocket state sharing is not implemented in this repo snapshot.
- Additional bundled adapters beyond `local-memory` are not implemented here.
