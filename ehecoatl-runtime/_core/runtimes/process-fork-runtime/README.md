# Process Fork Runtime

## Purpose

Main-process low-level supervisor runtime use case for spawning, tracking, and stopping child processes.

## Context

- Kernel context: `MAIN`
- Core files: `process-fork-runtime.js`, `managed-process.js`
- Adapter-backed: yes
- Default adapter: `child-process`

## Current Behavior

- Owns the process registry and PID-to-label mapping.
- Binds supervisor RPC listeners such as `shutdownProcess`, `ensureProcess`, `listProcesses`, and `processCounts`.
- Launches managed child processes and records lifecycle events for the watchdog and plugin hooks.
- Acts as the execution layer behind `multiProcessOrchestrator`, which now decides how layer/process intent becomes a concrete child fork.

## Ambiguities

- The default config comments mention possible alternatives like `worker_threads`, but the repo only ships the `child-process` adapter.
- Supervision behavior is implemented here, while restart policy is shared with `watchdog-orchestrator`, so responsibility is intentionally split across two use cases.

## Not Implemented Yet

- A bundled `worker_threads` or other non-fork supervision adapter is not implemented in this repo snapshot.
