# Systemd Unit

This folder contains the packaged systemd unit template for Ehecoatl.

## Why The Unit Runs As Root

The service starts as `root` because the bootstrap path is responsible for applying the configured runtime process identity and handing off controlled privilege boundaries during startup.

The unit does not rely on systemd's `User=` handoff for the full runtime tree. Instead, the bootstrap path:

- starts the launcher
- applies the configured runtime identity
- sanitizes capabilities
- starts supervised child processes with the identities defined by contracts and runtime policy

## Why Identity Switching Happens Inside Bootstrap

Ehecoatl needs fine-grained control over:

- root bootstrap behavior
- process identity switching
- capability sanitization
- child-process supervision

That is why the runtime performs identity switching inside the bootstrap code instead of delegating the full transition to the service manager alone.
