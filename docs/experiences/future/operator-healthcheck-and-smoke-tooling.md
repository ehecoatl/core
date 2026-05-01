# Operator Healthcheck and Smoke Tooling

This design topic is important because Ehecoatl already relies on smoke-style validation in engineering practice, but does not package that validation as a first-class operator tool.

## Gap

- The repository contains smoke criteria and engineering validation flows, but not a packaged runtime healthcheck command.
- Operators can inspect status and logs, but they cannot ask the product to run a first-class basic health and smoke pass.
- This leaves an obvious gap between runtime control and runtime verification.

## What A First-Class Experience Would Add

- A packaged CLI command to run basic health and smoke validation for install, deploy, and edge readiness.
- Clear pass/fail signals and scoped output for operator use.
- Alignment between day-to-day healthchecks and the engineering smoke criteria already described in docs.

## Current Related Surfaces

- [`docs/reference/first-release-smoke-criteria.md`](../../reference/first-release-smoke-criteria.md)
- `ehecoatl-runtime/cli/commands/core/status.sh`
- [`docs/experiences/operational-observability.md`](../surface/operational-observability.md)

## Risk

- Operators currently have to assemble health confidence from multiple surfaces instead of one packaged check.
