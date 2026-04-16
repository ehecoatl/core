# Plugins

Plugins are the extension mechanism built on top of the hook system.

## Loading Model

Each process bootstrap creates a `PluginExecutor`, then calls:

```js
plugin.scanPlugins(contextName, customPluginsPath, config.plugins)
```

The loader scans two locations in order:

1. bundled plugins under `app/plugins`
2. custom plugins under the configured external plugins path, which defaults to `/etc/opt/ehecatl/plugins`

Bundled plugins load first. A later plugin can replace an earlier plugin with the same exported `name` only when `config.plugins.<name>.override === true`. Duplicate names without that explicit override flag are rejected.

The loader accepts either:

- a single `.js` file plugin,
- a directory plugin with an `index.js` entry.

## Plugin Contract

A plugin must export an object with a `register(executor)` function. In practice, plugins usually also export:

- `name`
- `priority`

The `register` function is responsible for subscribing to the hooks it needs.

Plugins can also export:

- `contexts`: an optional array like `["MAIN", "MANAGER"]` to limit which process contexts load the plugin
- `teardown(context)`: an optional async cleanup hook called before unload or replacement

`config.plugins.<name>.contexts` can override the exported `contexts` list for one installation.

## Built-In Plugins Present In Ehecatl

The code currently present under `Ehecatl/app/plugins` includes:

- `logger-runtime`
- `error-reporter`

These are small examples that subscribe to active runtime hooks, including `MAIN.SUPERVISOR.HEARTBEAT` for main-process heartbeat visibility.

## Config-Declared Plugins vs Bundled Plugins

The default config lists more plugin keys than the bundled `app/plugins` directory currently contains. That means:

- some plugin names in `default.config.js` are intended optional or external integrations,
- Ehecatl can reference plugin configuration that is not implemented in this folder,
- a missing plugin file is not the same thing as a runtime hook capability being absent.

For this docs set, only plugin code that exists in `Ehecatl/` is treated as documented built-in behavior.

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
- Prefer external plugins in `/etc/opt/ehecatl/plugins` when you want to keep local customization outside the core codebase.

## Related Reading

- [Hooks](hooks.md)
- [Configuration](../reference/configuration.md)
