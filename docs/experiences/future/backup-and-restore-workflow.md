# Backup and Restore Workflow

This design topic is urgent because Ehecoatl exposes stateful runtime folders and backup-like paths without a packaged way to capture, validate, and restore them safely.

## Gap

- The runtime has `.backups` and other state surfaces, but no first-class backup workflow.
- There is no restore command, restore validation path, or documented recovery procedure as a packaged operator experience.
- Cleanup and purge flows exist, which increases the need for a trustworthy recovery counterpart.

## What A First-Class Experience Would Add

- Packaged backup commands or scripts for the supported runtime state surfaces.
- Restore procedures with validation steps and compatibility guidance.
- Optional retention or snapshot labeling behavior to support recoverability without manual conventions.

## Current Related Surfaces

- [`docs/core-concepts/tenancy.md`](../../core-concepts/tenancy.md)
- `setup/uninstall.sh`
- `setup/uninstall/purge-data.sh`

## Risk

- The system currently supports destructive cleanup better than it supports structured recovery.
