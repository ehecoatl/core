# Hooks

Ehecatl exposes a numeric hook registry that plugins can subscribe to through `PluginExecutor`.

## Why Hooks Exist

Hooks let you attach behavior around runtime events without changing the gateway classes directly. The same pattern is used for:

- process lifecycle,
- request and response flow,
- pipeline stages,
- RPC transport,
- queueing,
- storage,
- shared cache.

## Hook Contexts

The hook map is declared in `app/config/plugin-hooks.config.js` and grouped into these contexts:

- `SHARED`
- `MAIN`
- `ENGINE`
- `MANAGER`
- `TENANT`

Each plugin executor is created with one process label and one context. A process can subscribe to hooks in its own context plus the shared hook range.

## Hook Shapes

The current hook registry uses a few repeating shapes:

- Wrapper hooks: `BEFORE`, `AFTER`, `ERROR`
- Flow hooks: `START`, `END`, `BREAK`, `ERROR`
- Process hooks: `SPAWN`, `READY`, `ERROR`, `CRASH`, `RESTART`, `SHUTDOWN`, `HEARTBEAT`, `BOOTSTRAP`, `DEAD`
- Channel hooks: `RECEIVE`, `SEND`, `TIMEOUT`, `ERROR`

## Registering a Listener

Plugins register listeners through `executor.on(id, fn, { plugin, priority })`.

Example pattern:

```js
module.exports = {
  name: 'example-plugin',
  priority: 0,
  async register(executor) {
    const { PROCESS } = executor.hooks.MAIN;
    executor.on(PROCESS.READY, async (ctx) => {
      console.log('process ready', ctx.processLabel);
    }, { plugin: this.name, priority: this.priority });
  }
};
```

## Execution Rules

- Listeners are sorted by ascending priority.
- Hook payloads are normalized into an object and automatically receive `processLabel`.
- If a listener throws and an error hook is provided, the executor forwards the failure to that error hook.
- A hook context can mark itself aborted, which stops later listeners in the same run.

## Where Hooks Are Used

Examples from the current runtime:

- process bootstrap and shutdown in the bootstrap modules,
- per-stage wrapping in `RequestPipeline`,
- request body and response write flow in the `uws` adapter,
- RPC ask and answer flow in `RpcEndpoint`,
- storage and shared-cache adapter wrappers in the shared services,
- supervisor heartbeat and reload flow in the main process.

## Practical Guidance

- Use shared hooks for cross-cutting concerns such as RPC, storage, and cache instrumentation.
- Use process hooks for startup, shutdown, and health visibility.
- Use request and pipeline hooks for tracing, metrics, and policy enforcement.
- Keep listeners fast, because they run inline with the lifecycle they are observing.
