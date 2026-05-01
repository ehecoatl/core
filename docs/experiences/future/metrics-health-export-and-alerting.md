# Metrics, Health Export, and Alerting

This design topic is urgent because Ehecoatl currently exposes status, logs, and internal heartbeat behavior without a first-class monitoring and alerting surface.

## Gap

- There is no packaged metrics export, alert integration, or operator health feed.
- Heartbeat and restart logic exist internally, but they are not exposed as a standard monitoring interface.
- The docs mention tracing and metrics as possible hook use cases, but not as delivered product behavior.

## What A First-Class Experience Would Add

- A stable health and metrics export surface for operators and external monitoring systems.
- Alert-friendly signals for process restarts, missed heartbeats, reload churn, and service degradation.
- A documented boundary between shipped observability and optional custom instrumentation.

## Current Related Surfaces

- [`docs/features/hooks.md`](../../features/hooks.md)
- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter.js`
- `ehecoatl-runtime/cli/commands/core/status.sh`

## Risk

- Operators can see failures after the fact, but the system does not yet help them monitor degradation proactively.
