# Version Manager and Release Dispatch

This experience makes release selection, checkout caching, install handoff, and uninstall handoff feel like one packaged operator flow instead of a set of unrelated shell steps.

## Experience

- `ehecoatl-core.sh` acts as a standalone manager that can be run from a release checkout or from its canonical copy in `~/ehecoatl/ehecoatl-core.sh`.
- Stable releases and pre-releases can be listed separately from published version tags, downloaded into `~/ehecoatl/<release>`, and then installed from that cached checkout.
- The manager can hand off to the matching release's packaged installer or uninstaller instead of assuming the current working tree is the active installation.
- The manager keeps a canonical home copy synchronized so the preferred operator entrypoint stays stable across release downloads.

## Implementation

- The manager resolves the invoking developer home, keeps a canonical synced copy in `~/ehecoatl/`, and can re-exec the newer canonical copy when needed.
- Downloaded releases are staged as local checkouts under `~/ehecoatl/<release>`.
- `--releases` lists stable version tags, while `--pre-releases` lists tags with semver pre-release suffixes such as `0.0.3-alpha` or `v1.0.0-rc.1`.
- Install handoff runs the downloaded release's `setup/bootstrap.sh --complete`.
- Uninstall handoff resolves the installed release from install metadata, ensures the matching checkout exists locally, and runs that release's `setup/uninstall.sh`.

## Key Files

- [`ehecoatl-core.sh`](../../ehecoatl-core.sh)
- `setup/bootstrap.sh`
- `setup/install.sh`
- `setup/uninstall.sh`
- [`docs/reference/setup-and-maintenance.md`](../../reference/setup-and-maintenance.md)

## Related Docs

- [Host Lifecycle Management](host-lifecycle-management.md)
- [Scoped CLI Operations](scoped-cli-operations.md)
- [Repository Structure](../../reference/repository-structure.md)
