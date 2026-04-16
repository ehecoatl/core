# Watchdog Orchestrator

## Purpose

Main-process health orchestrator use case for heartbeat tracking, unhealthy-process reloads, and crash relaunch decisions.

## Context

- Kernel context: `MAIN`
- Core files: `watchdog-orchestrator.js`, `heartbeat-reporter.js`
- Adapter-backed: no

## Current Behavior

- Tracks heartbeat timeouts and health snapshots by process label.
- Decides whether a process is healthy from ELU and event-loop lag thresholds.
- Requests reloads or relaunches through the process fork runtime when processes become unhealthy or exit unexpectedly.

## Ambiguities

- Heartbeat enforcement is here, but the actual heartbeat payload production happens elsewhere, so end-to-end health semantics span multiple modules.
- Reload behavior depends on process type and launcher metadata supplied by the process fork runtime.

## Not Implemented Yet

- No obvious stub exists in this directory, but health policy remains limited to the metrics currently included in heartbeat payloads.
