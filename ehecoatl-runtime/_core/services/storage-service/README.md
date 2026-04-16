# Storage Service

## Purpose

Shared filesystem-style service use case for reading, writing, listing, and deleting storage paths.

## Context

- Kernel contexts: `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`
- Core file: `storage-service.js`
- Adapter-backed: yes
- Default adapter: `local`

## Current Behavior

- Wraps storage adapter calls in plugin hooks.
- Exposes file, stream, folder, and stat operations used across tenancy, request handling, and cleanup tasks.
- Bundled `local` adapter maps the storage contract to the Node filesystem APIs.

## Ambiguities

- Default config comments mention future backends like `s3` and `gcs`, but the repo only ships the `local` adapter.
- Some adapter methods are thin pass-throughs, so behavior depends heavily on the active backend implementation.

## Not Implemented Yet

- Bundled `s3` and `gcs` storage adapters are not implemented in this repo snapshot.
