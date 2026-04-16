# Extension Templates

These files are the canonical starter content used by:

- `ehecoatl tenant make plugin`
- `ehecoatl app make plugin`
- `ehecoatl app make middleware`
- `ehecoatl app make action`

The `make` command copies these files into the target scope instead of hardcoding inline shell stubs.

Each template includes short inline comments explaining the visible properties and
the intended place for custom code.

Middleware extension templates are intended for tenant/app route middleware and
therefore receive `MiddlewareContext`, the limited facade exposed by the native
middleware stack orchestrator.
