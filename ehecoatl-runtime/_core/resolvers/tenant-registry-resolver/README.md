# Tenant Registry Resolver

## Purpose

Director-side resolver that persists the active tenant/app registry into the runtime registry tree.

## Context

- Kernel context: `DIRECTOR`
- Core file: `tenant-registry-resolver.js`
- Adapter-backed: yes
- Default adapter: `default-runtime-registry-v1`

## Current Behavior

- Consumes the in-memory registry produced by `tenantDirectoryResolver`.
- Resolves source and target roots from the supervision-scope contract:
  - `PATHS.INTERNAL.tenants`
  - `PATHS.RUNTIME.registry`
- Mirrors active tenants/apps into the runtime registry folder using only `config.json` files inside each tenant/app folder.
- Persists merged app config plus compiled route artifacts for later runtime consumption.
