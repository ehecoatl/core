# Ehecatl OpenCore

Ehecatl OpenCore is the codebase slice in this repository that provides the shared runtime for multi-tenant HTTP and WebSocket traffic. It combines a supervised multi-process architecture, filesystem-driven tenant discovery, an adapter-based gateway layer, and hookable request execution.

## What OpenCore Includes

- A `main` supervisor process that boots and monitors child processes
- A `manager` process for tenancy, queue, and shared coordination
- One or more `engine` processes that accept network traffic and run the request pipeline
- On-demand `tenant_*` processes that load tenant controller code for a single host
- Built-in adapters for IPC, local storage, Redis or in-memory cache, and queueing
- A plugin system for attaching logic to process, request, response, RPC, cache, and storage hooks

## Runtime Requirements

- Linux-oriented setup and maintenance scripts
- `Node.js 24`
- `systemd` available through `systemctl`
- System privileges for setup, user provisioning, ACL changes, and firewall rules

## Quick Start

From an existing checkout:

```bash
chmod +x setup/bootstrap-system.sh
./setup/bootstrap-system.sh
/opt/ehecatl/setup/setup-ehecatl.sh
```

For a fresh machine install where you also want a local Redis managed by Ehecatl:

```bash
chmod +x setup/bootstrap-system.sh
./setup/bootstrap-system.sh
/opt/ehecatl/setup/setup-ehecatl.sh
/opt/ehecatl/setup/bootstrap-redis.sh
```

The packaged setup flow provisions runtime users, publishes the `ehecatl` CLI, creates `/var`, `/srv`, and `/etc` paths, writes split JSON config files under `/etc/opt/ehecatl/config`, and installs the `ehecatl.service` systemd unit. Runtime control is exposed through the packaged CLI commands such as `ehecatl start`, `ehecatl stop`, `ehecatl status`, and `ehecatl log`.

## Documentation

- [Docs Index](docs/README.md)
- [Introduction](docs/introduction.md)
- [Getting Started](docs/getting-started.md)
- [Core Concepts: Architecture](docs/core-concepts/architecture.md)
- [Core Concepts: Request Lifecycle](docs/core-concepts/request-lifecycle.md)
- [Core Concepts: Tenancy](docs/core-concepts/tenancy.md)
- [Features: Hooks](docs/features/hooks.md)
- [Features: Plugins](docs/features/plugins.md)
- [Features: Adapters](docs/features/adapters.md)
- [Reference: CLI](docs/reference/cli.md)
- [Reference: Configuration](docs/reference/configuration.md)
- [Reference: Runtime Policy](docs/reference/runtime-policy.md)
- [Reference: Repository Structure](docs/reference/repository-structure.md)
- [Reference: Setup and Maintenance](docs/reference/setup-and-maintenance.md)
- [Documentation Scope](docs/editions.md)

## Scope

This documentation set describes the repository snapshot represented here, including `app/`, `setup/`, `setup/cli/`, and `docs/`.

## License

Define the project license here when it is ready for publication.
