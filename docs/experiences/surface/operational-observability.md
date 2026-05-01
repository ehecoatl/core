# Operational Observability

This experience gives operators productized visibility into runtime state through packaged status, logs, and service-manager-facing control points.

## Experience

- Core runtime status is exposed through packaged commands instead of requiring direct process inspection.
- Service logs remain accessible from the same operational CLI surface used for lifecycle control.
- Boot and error logs are centralized under contract-defined supervision log roots.
- The delivered observability surface is centered on status, logs, and supervision-visible behavior, not on packaged metrics, tracing, or alerting.

## Implementation

- CLI status and log commands wrap the service manager instead of hiding control behind custom daemons.
- `boot-logger` writes process bootstrap events to `/var/log/ehecoatl/boot`.
- `error-reporter` writes process errors to `/var/log/ehecoatl/error`.
- `logger-runtime` keeps lifecycle and supervision activity visible through runtime logging hooks.
- Runtime supervision and restart behavior feed into the operational signals operators care about most.
- The service unit keeps the runtime under a standard host process manager for familiar inspection and restart semantics.

## Key Files

- `ehecoatl-runtime/cli/commands/core/status.sh`
- `ehecoatl-runtime/cli/commands/core/log.sh`
- `ehecoatl-runtime/systemd/ehecoatl.service`
- `ehecoatl-runtime/builtin-extensions/plugins/boot-logger.js`
- `ehecoatl-runtime/builtin-extensions/plugins/error-reporter.js`
- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/watchdog-orchestrator.js`

## Related Docs

- [Scoped Logging and Status](scoped-logging-and-status.md)
- [Process Supervision and Restart Policy](../nucleus/process-supervision-and-restart-policy.md)
- [Setup and Maintenance](../../reference/setup-and-maintenance.md)
