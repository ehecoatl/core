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

Tenant and app targeting is derived from the current working directory by default rather than from a persistent shell session or context file.

Tenant commands may also use an explicit domain target immediately after the `tenant` scope:

```bash
ehecoatl tenant @example.test status
ehecoatl tenant @example.test deploy app www -a test
```

When that override is present, tenant resolution ignores the current directory and uses the explicit domain. Non-root users still need membership in the resolved tenant group.

Deploy commands accept kit names directly and can use folder or `.zip` kit artifacts: `-t test` resolves to `tenant-kits/test/` or `tenant-kits/test.zip`, and `-a test` resolves to `app-kits/test/` or `app-kits/test.zip`. Missing kits are checked in custom extension kit roots and then public fallback repos such as `https://github.com/ehecoatl/tenant-kit-blog.git` or `https://github.com/ehecoatl/app-kit-panel.git`; matching repos are cloned into the custom kit root. Zip kits must place kit files directly at the archive root. Tenant kits may include top-level `app_<name>/` folders; these are auto-deployed as apps during tenant deploy. `--repo` records metadata only and does not clone repository content.

## Related Sources

- [CLI contracts](../contracts/cli-specs/README.md)
- [Reference CLI documentation](../../docs/reference/cli.md)
