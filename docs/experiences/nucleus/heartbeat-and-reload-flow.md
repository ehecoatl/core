# Heartbeat and Reload Flow

This experience defines how supervised child processes prove health over time and how the runtime replaces them when health degrades.

## Experience

- Runtime health is tracked continuously, not only when a process exits.
- Reload attempts favor a drain-and-restart flow before escalating to forced termination.
- Heartbeat quality thresholds make supervision sensitive to event loop stress and lag, not just missing pings.

## Implementation

- Child runtimes emit periodic heartbeats with health metrics.
- The watchdog tracks timeout and threshold violations and turns them into reload decisions.
- Reload logic coordinates drain requests, graceful exit timeouts, and final relaunch.

## Key Files

- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter.js`
- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/watchdog-orchestrator.js`
- `ehecoatl-runtime/_core/runtimes/process-fork-runtime/process-fork-runtime.js`
- `ehecoatl-runtime/bootstrap/process-transport.js`

## Related Docs

- [Process Supervision and Restart Policy](process-supervision-and-restart-policy.md)
- [Scoped Logging and Status](../surface/scoped-logging-and-status.md)
- [Configuration](../../reference/configuration.md)
