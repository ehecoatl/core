# Scoped Logging and Status

This experience keeps operational visibility close to the packaged CLI so service status and logs can be checked without collapsing into host-specific troubleshooting habits.

## Experience

- Operators can ask the packaged runtime for status instead of locating processes manually.
- Service logs remain reachable from the same CLI surface used for start and stop.
- Status and logs are scoped to the installed runtime rather than treated as generic host noise.
- Bootstrap and error files are written under the supervision log roots declared by the contracts.

## Implementation

- Core status and log commands wrap the service manager directly.
- The packaged service unit anchors process state to a known host service name.
- `boot-logger`, `logger-runtime`, and `error-reporter` centralize boot, lifecycle, and error output through hooks.
- Supervision and heartbeat signals shape the runtime states operators inspect when diagnosing failures.

## Key Files

- `ehecoatl-runtime/cli/commands/core/status.sh`
- `ehecoatl-runtime/cli/commands/core/log.sh`
- `ehecoatl-runtime/systemd/ehecoatl.service`
- `ehecoatl-runtime/builtin-extensions/plugins/boot-logger.js`
- `ehecoatl-runtime/_core/orchestrators/watchdog-orchestrator/heartbeat-reporter.js`

## Related Docs

- [Operational Observability](operational-observability.md)
- [Process Supervision and Restart Policy](../nucleus/process-supervision-and-restart-policy.md)
- [CLI](../../reference/cli.md)
