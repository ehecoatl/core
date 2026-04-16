# Request URI Route Resolver

## Purpose

Director-side runtime that matches request URLs to the active tenant/app route target.

## Context

- Kernel context: `DIRECTOR`
- Core file: `request-uri-route-resolver.js`
- Adapter-backed: yes
- Default adapter: `default-uri-router-runtime`

## Current Behavior

- Caches route matches locally for a configurable TTL.
- Resolves routes from the tenant registry and delegates host/app/path matching to the adapter.
- Clears local cache on registry updates and can invalidate shared response-cache artifacts.

## Ambiguities

- The runtime keeps both local cache and shared-cache invalidation responsibilities, so route matching and cache hygiene are intentionally coupled here.
- Route-miss caching is configured in `default.config.js`, but this runtime file only shows positive match caching directly.

## Not Implemented Yet

- Additional bundled URI router adapters are not implemented in this repo snapshot.
