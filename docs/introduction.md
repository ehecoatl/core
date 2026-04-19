# Introduction

Ehecoatl is the runtime foundation for a multi-tenant web platform. In the current repository layout, the codebase is organized around a small number of responsibilities:

- `ehecoatl-runtime/` contains the runtime use cases, services, ports, adapters, plugins, and configuration.
- `setup/` contains the shell bootstrap, install, uninstall, purge, and optional infrastructure scripts; packaged runtime artifacts such as the CLI, contracts, templates, systemd unit, helper libraries, and built-in extensions live under `ehecoatl-runtime/`.
- `docs/` contains the project documentation.

The runtime is designed around a supervised multi-process architecture, a code-first configuration model with external JSON overrides, and filesystem-driven tenancy.

Start with [Getting Started](getting-started.md) if you need to install or run Ehecoatl.
