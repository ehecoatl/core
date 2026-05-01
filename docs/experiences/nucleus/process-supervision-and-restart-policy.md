# Process Supervision and Restart Policy

This experience keeps supervised child processes recoverable by monitoring health, draining work, and relaunching unhealthy or crashed runtimes automatically, while keeping that behavior distinct from top-level service restart.

## Experience

- Operators do not need to rebuild the child process graph manually after a child crash.
- Health is treated as more than simple liveness because heartbeat quality also matters.
- Child restart behavior inside the runtime and top-level `systemd` restart behavior remain distinct and explicit.

## Implementation

- `main` supervises child runtimes and reacts to heartbeat failures and unexpected exits.
- The watchdog coordinates graceful drain, exit waiting, and relaunch for unhealthy children.
- `systemd` separately restarts the packaged top-level service if the whole runtime service exits.

## Key Files

- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/watchdog-orchestrator.js`
- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter.js`
- `ehecoatl-runtime/_core/runtimes/process-fork-runtime/process-fork-runtime.js`
- `ehecoatl-runtime/systemd/ehecoatl.service`

## Related Docs

- [Heartbeat and Reload Flow](heartbeat-and-reload-flow.md)
- [Operational Observability](../surface/operational-observability.md)
- [Runtime Topology](rpc-and-runtime-topology.md)
