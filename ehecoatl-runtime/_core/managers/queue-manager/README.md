# Queue Manager

## Purpose

Director-side manager use case for delayed work and per-queue concurrency control.

## Context

- Kernel context: `DIRECTOR`
- Core file: `queue-manager.js`
- Adapter-backed: yes
- Default adapter: `event-memory`

## Current Behavior

- Loads the configured queue adapter eagerly in the constructor.
- Exposes `appendToQueue`, `removeFromQueue`, and `removeTasksByOrigin`.
- Emits plugin hooks through `DIRECTOR.QUEUE_BROKER`.

## Ambiguities

- The repo only ships an in-memory queue adapter, so "queue broker" currently means process-local coordination inside the director rather than a durable broker.
- There is no bundled evidence here for cross-director or cross-host queue ownership.

## Not Implemented Yet

- Persistent or distributed queue backends are not implemented in this repo snapshot.
