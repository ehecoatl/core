# CLI

This folder contains the packaged `ehecoatl` command-line interface shipped with the runtime.

## Structure

- `ehecoatl.sh`
  Top-level dispatcher installed as `/usr/local/bin/ehecoatl`.
- `commands/`
  Scope-specific shell commands for `core`, `tenant`, `app`, and `firewall`.
- `lib/`
  Shared helpers used by command implementations.

## Command Model

The CLI dispatches by explicit scope:

- `ehecoatl core ...`
- `ehecoatl tenant ...`
- `ehecoatl app ...`
- `ehecoatl firewall ...`

Tenant and app targeting is derived from the current working directory rather than from a persistent shell session or context file.

## Related Sources

- [CLI contracts](../contracts/cli-specs/README.md)
- [Reference CLI documentation](../../docs/reference/cli.md)
