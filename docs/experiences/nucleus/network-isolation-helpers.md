# Network Isolation Helpers

This experience gives the runtime a narrow privileged network-control surface without turning firewall behavior into a general-purpose extension mechanism.

## Experience

- Firewall operations are explicit commands instead of hidden side effects in unrelated setup logic.
- Privileged network-control behavior remains launcher-side and tightly scoped.
- The runtime can describe network-isolation intent through policy without broadening the privileged surface arbitrarily.

## Implementation

- Root-only firewall commands implement deterministic WAN-block and local-proxy helpers.
- Runtime policy names the command entrypoints used by the launcher side of the runtime.
- Documentation treats these helpers as privileged infrastructure controls, not as a general admin shell surface.

## Key Files

- [`docs/reference/runtime-policy.md`](../../reference/runtime-policy.md)
- [`docs/reference/cli.md`](../../reference/cli.md)
- `ehecoatl-runtime/cli/commands/firewall/newtork_wan_block.sh`
- `ehecoatl-runtime/cli/commands/firewall/newtork_local_proxy.sh`

## Related Docs

- [Process Isolation and Identity Model](process-isolation-and-identity-model.md)
- [Runtime Policy](../../reference/runtime-policy.md)
- [Scoped CLI Operations](../surface/scoped-cli-operations.md)
