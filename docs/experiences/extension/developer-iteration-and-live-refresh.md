# Developer Iteration and Live Refresh

This experience supports a fast code-change loop by combining deploy, rescan, and weak-load refresh behavior without redefining the runtime topology on every edit.

## Experience

- Tenant and app deploys move code into the packaged topology through stable commands.
- Director rescans make new deploy state visible to the live runtime without full service teardown.
- Runtime-late loading lets selected deploy-facing code surfaces refresh while the core runtime stays eagerly loaded.

## Implementation

- Deploy commands trigger a direct director rescan after filesystem and ACL changes.
- App entrypoints, actions, and middleware are the supported runtime-late loading surfaces.
- Weak-load and require-cache-flush behavior keep late-loading explicit instead of relying on ambient module state.

## Key Files

- `ehecoatl-runtime/cli/commands/shared/deploy.sh`
- `ehecoatl-runtime/cli/commands/core/rescan_tenants.sh`
- `ehecoatl-runtime/utils/module/weak-require.js`
- `ehecoatl-runtime/utils/module/clear-require-cache.js`

## Related Docs

- [Tenant and App Deployment Flow](../surface/tenant-and-app-deployment-flow.md)
- [Require Cache Flush and Weak Loading](../nucleus/require-cache-flush-and-weak-loading.md)
- [Registry Scan and Reconciliation](../surface/registry-scan-and-reconciliation.md)
