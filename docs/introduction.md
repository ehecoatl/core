# Introduction

Ehecatl is the runtime foundation for a multi-tenant web platform. In the current repository layout, the codebase is organized around a small number of responsibilities:

- `app/` contains the runtime, gateways, services, adapters, plugins, and configuration.
- `setup/` contains bootstrap, setup, uninstall, purge, Redis, support libraries, templates, service-management scripts, and the packaged CLI under `setup/cli/`.
- `docs/` contains the project documentation.

The runtime is designed around a supervised multi-process architecture, a code-first configuration model with external JSON overrides, and filesystem-driven tenancy.

Start with [Getting Started](getting-started.md) if you need to install or run Ehecatl.
