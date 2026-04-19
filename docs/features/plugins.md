# Plugins

Plugins are the extension mechanism built on top of the hook system.

## Loading Model

Each process kernel creates a `PluginOrchestrator` and a `PluginRegistryResolver`, then loads plugins by resolving registry entries and registering them into the orchestrator:

```js
const useCases = await kernel({ config, processLabel });
const plugin = useCases.pluginOrchestrator;
```

The registry resolver scans plugin directories in order:

1. bundled plugins under `ehecoatl-runtime/builtin-extensions/plugins`
2. global custom plugins under the configured external plugins path, which defaults to `/srv/opt/ehecoatl/plugins`
3. additional layer-specific plugin paths appended by the active kernel context when applicable

Bundled plugins resolve first. A later plugin can replace an earlier plugin with the same exported `name` only when `config.plugins.<name>.override === true`. Duplicate names without that explicit override flag are rejected by the orchestrator during registration.

Current appended scan order is:

- `TRANSPORT`: bundled -> global -> tenant workspace plugins
- `ISOLATED_RUNTIME`: bundled -> global -> tenant shared plugins -> isolated app plugins

That means precedence is:

- global custom overrides bundled
- tenant-local overrides global
- app-local overrides tenant-local

The loader accepts either:

- a single `.js` file plugin,
- a directory plugin with an `index.js` entry.

## Plugin Contract

A plugin must export an object with a `register(executor)` function. In practice, plugins usually also export:

- `name`
- `priority`

The `register` function is responsible for subscribing to the hooks it needs.

Plugins can also export:

- `contexts`: an optional array like `["MAIN", "DIRECTOR"]` to limit which process contexts load the plugin
- `teardown(context)`: an optional async cleanup hook called before unload or replacement

`config.plugins.<name>.contexts` can override the exported `contexts` list for one installation.

## Built-In Plugins Present In Ehecoatl

The code currently present under `Ehecoatl/ehecoatl-runtime/builtin-extensions/plugins` includes:

- `boot-logger`
- `logger-runtime`
- `error-reporter`

These subscribe to active runtime hooks. `boot-logger` listens to `PROCESS.BOOTSTRAP` and writes boot lines into `PATHS.LOGS.boot`, `logger-runtime` covers runtime/supervision lifecycle signals, and `error-reporter` writes process errors into `PATHS.LOGS.error`.

## Enabling and Disabling

The plugin loader checks `config.plugins[pluginName].enabled === false` to skip a plugin. This makes `plugins` the central place to disable bundled or custom plugins per installation.

## Replacement And Teardown

Replacement is explicit:

- duplicate plugin names are rejected by default
- setting `config.plugins.<name>.override = true` allows a later plugin to replace the earlier one
- the earlier plugin's `teardown()` runs before its listeners are removed
- if `teardown()` fails, the old plugin stays loaded and replacement aborts

This keeps unload and replacement from silently leaving half-removed plugin state behind.

## Context Activation

Plugins still register individual hook listeners, but loading is no longer purely "load everywhere and let hook ranges filter it." A plugin can now opt into explicit context activation through:

- `plugin.contexts`
- `config.plugins.<name>.contexts`

That keeps bundled and custom plugins aligned on the same activation rule.

## Best Practices For Custom Plugins

- Register only the hooks needed for the current process context.
- Keep listeners lightweight and non-blocking where possible.
- Use priorities intentionally when ordering matters.
- Treat hook payload shapes as runtime contracts and avoid mutating unrelated fields.
- Prefer external plugins in `/srv/opt/ehecoatl/plugins` when you want to keep install-wide customization outside the core codebase.

## Related Reading

- [Hooks](hooks.md)
- [Configuration](../reference/configuration.md)
