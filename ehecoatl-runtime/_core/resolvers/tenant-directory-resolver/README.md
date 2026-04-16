# Tenant Directory Resolver

## Purpose

Director-side resolver that scans tenant folders, validates layout/config, and builds the active host registry.

## Context

- Kernel context: `DIRECTOR`
- Core file: `tenant-directory-resolver.js`
- Adapter-backed: yes
- Default adapter: `default-tenancy`

## Current Behavior

- Coordinates scans of the tenants filesystem through the storage service and tenancy adapter.
- Attaches the route matcher compiler, URI router runtime, tenant registry resolver, and web server service so registry changes can fan out.
- Serves as the registry source for route matching and server-certificate updates.

## Ambiguities

- Most scan and validation rules live in the adapter, not this resolver use case, so behavior is split between core and adapter code.
- Spawning tenant apps after scans is config-driven, which means some lifecycle effects happen indirectly from registry refresh.

## Not Implemented Yet

- No additional bundled tenancy adapters are implemented in this repo snapshot.
