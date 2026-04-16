# CLI Reference

The installed `ehecatl` executable is a dispatcher symlink that points to `setup/cli/ehecatl.sh`. The dispatcher looks for a command file whose name matches the first CLI argument under `setup/cli/commands/<command>.sh`. If no matching command file is found, it can still fall back to app-level npm scripts where applicable, but packaged operational commands should prefer dedicated command files.

## Bundled Command Files

The current bundled command names are:

- `start`
- `stop`
- `restart`
- `status`
- `log`
- `tenant_create`
- `firewall_setup`
- `firewall_release`
- `proxy_setup`
- `proxy_release`
- `proxy_release_all`

Repository filenames use the `.sh` extension, but the user-facing command names stay extensionless through the dispatcher.

## Runtime Control

### `ehecatl start`
Starts `ehecatl.service`.

### `ehecatl stop`
Stops `ehecatl.service`.

### `ehecatl restart`
Restarts `ehecatl.service`.

### `ehecatl status`
Shows service status for `ehecatl.service`.

### `ehecatl log`
Streams recent and live logs from `ehecatl.service`.

## Tenant Scaffolding

### `ehecatl tenant_create <domain> [-host <hostname>]`
Creates the initial filesystem scaffold for a tenant host.

Example:

```bash
ehecatl tenant_create example.com -host www
```

## Operational Notes

- The repository command file name is `tenant_create.sh`, but the command remains `tenant_create`.
- Runtime control commands are first-class packaged commands and should be preferred over direct `npm run start` or `npm run stop` usage for service-managed installs.
