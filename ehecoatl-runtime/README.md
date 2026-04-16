# Ehecoatl Runtime

This folder is the packaged runtime payload for Ehecoatl.

It is the part of the repository that is copied into `/opt/ehecoatl` during bootstrap and then used for runtime execution.

## Main Areas

- `index.js`
  Root runtime entrypoint.
- `bootstrap/`
  Runtime bootstrap entrypoints and launcher logic.
- `config/`
  Default runtime configuration, user-config merge, and adapter loading.
- `contracts/`
  Human-readable runtime contracts used for topology and policy derivation.
- `cli/`
  Packaged CLI entrypoints, commands, and helpers.
- `_core/`
  Kernel, orchestrators, ports, and core runtime logic.
- `extensions/`
  Built-in app kits, tenant kits, plugins, and adapters shipped with the runtime.
- `systemd/`
  Packaged service unit files.

## Startup Model

The runtime starts through [index.js](./index.js).

That entrypoint:

- registers module aliases
- runs startup logging intro
- loads [bootstrap/bootstrap.js](./bootstrap/bootstrap.js)

The bootstrap launcher then forks [bootstrap/bootstrap-main.js](./bootstrap/bootstrap-main.js), which becomes the root supervisor process and spawns the other managed runtime processes.
The canonical startup chain is:

```text
systemd
  -> index.js
    -> bootstrap/bootstrap.js
      -> fork bootstrap/bootstrap-main.js (main)
        -> multiProcessOrchestrator.forkProcess('supervisionScope', 'director')
          -> first tenant scan
          -> main-side ensure e_transport_{tenant_id}
          -> main-side ensure e_app_{tenant_id}_{app_id}
```

In this model, `main` is the root process of the `supervisionScope` layer, and `director` is the first supervised child that turns scan results into tenant/app process supervision.

## Privilege Boundary

Network administration privilege is intentionally isolated at the service entrypoint boundary.

- `index.js` starts the launcher flow.
- [bootstrap/bootstrap.js](./bootstrap/bootstrap.js) keeps only `CAP_SETUID`, `CAP_SETGID`, and `CAP_NET_ADMIN`.
- [bootstrap/bootstrap-main.js](./bootstrap/bootstrap-main.js) drops `CAP_NET_ADMIN` before continuing boot and keeps only `CAP_SETUID` and `CAP_SETGID`.
- [bootstrap/bootstrap-director.js](./bootstrap/bootstrap-director.js), [bootstrap/bootstrap-transport.js](./bootstrap/bootstrap-transport.js), and [bootstrap/bootstrap-isolated-runtime.js](./bootstrap/bootstrap-isolated-runtime.js) drop all inherited Linux capabilities before continuing boot.

This means `CAP_NET_ADMIN` is isolated to the launcher path and is not retained by the forked runtime processes where custom third-party code may run.

The direct launcher bridge is owned by the `MAIN` bootstrap path only. It exists so the main supervisor can request a single-purpose network setup or update operation without exposing general network-administration capability to the rest of the runtime.

## Contracts as Source of Truth

The runtime contracts under [contracts/](./contracts/) are the structural source of truth for:

- service supervision, tenant ingress, and tenant app layers
- runtime paths and topology roots
- process identity and bootstrap entries
- process label templates for supervised forks
- setup topology derivation
- runtime-policy derivation

The setup scripts consume derivations from those contracts rather than defining a second structural model in parallel.

## Scope

This folder is for installed runtime content.

It is distinct from:

- `setup/`
  host-side install, bootstrap, uninstall, and purge scripts
- `docs/`
  project documentation

## Notes

- Paths and topology described here should stay aligned with the contracts in [contracts/](./contracts/).
- Built-in extension content in [extensions/](./extensions/) is part of the installed runtime payload.
