# Middleware Stack Orchestrator

## Purpose

Transport-side orchestrator use case that executes the ordered HTTP middleware stack.

## Context

- Kernel context: `TRANSPORT`
- Core files: `middleware-stack-runtime.js`, `middleware-context.js`
- Adapter-backed: no
- Core middleware source: `extensions/middlewares/core.js`

## Current Behavior

- Executes two HTTP stacks in order:
  - core middleware stack using raw `ExecutionContext`
  - route middleware stack using `MiddlewareContext`
- Runs composed async middleware with `next()` wrapping semantics instead of the old boolean pipeline.
- Resolves route middleware labels from tenant/app HTTP middleware registries via `middleware-stack-resolver`.

## Notes

- Core middleware order is declared by `extensions/middlewares/core.js`.
- Route middleware labels use canonical `middleware`, while `middlewares` is still accepted as a compatibility alias.
- Dynamic label-based middleware resolution is HTTP-only in the current round.
