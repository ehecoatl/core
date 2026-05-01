# Tenancy and Addressing Model

This experience turns deployed filesystem topology into routable tenant and app addresses through explicit domain, alias, and routing rules.

## Experience

- Domains, aliases, and default app behavior determine how a deployed tenant becomes reachable.
- The runtime supports both subdomain and path-based app routing within the tenancy model.
- Opaque tenant and app identifiers stabilize process labels and deployed layout even when public hostnames stay human-facing.

## Implementation

- The tenancy scanner resolves domains, aliases, app routing mode, and route metadata from the tenant tree.
- Runtime labels and process identities derive from tenant and app identifiers rather than raw hostnames.
- Director reconciliation updates runtime state when tenancy topology changes on disk.

## Key Files

- [`docs/core-concepts/tenancy.md`](../../core-concepts/tenancy.md)
- `ehecoatl-runtime/builtin-extensions/adapters/inbound/tenant-directory-resolver/default-tenancy.js`
- `ehecoatl-runtime/utils/tenancy/tenant-layout.js`

## Related Docs

- [Registry Scan and Reconciliation](../surface/registry-scan-and-reconciliation.md)
- [Tenant and App Deployment Flow](../surface/tenant-and-app-deployment-flow.md)
- [Architecture](../../core-concepts/architecture.md)
