# Tenancy

Ehecatl resolves tenants from the filesystem. The manager process scans the configured tenants directory and builds route metadata for each domain and host.

## Default Tenant Root

The bundled configuration and runtime policy point tenancy to:

```text
/var/opt/ehecatl/tenants
```

The default tenancy adapter reads this tree as:

```text
<tenantsBase>/
  <domain>/
    <host>/
      src/
        config.json
        app/
        public/
      cache/
      log/
      spool/
```

The packaged CLI `tenant_create` command creates the host skeleton for you. In the repository, the dispatcher lives under `setup/cli/` and maps the user-facing command to `setup/cli/commands/tenant_create.sh`.

## Host Configuration

The tenancy scanner reads only `src/config.json` inside each host directory when building in-memory route data for that host.

The host-level config may also define:

- `hostEnabled`: when set to `false` in `src/config.json`, the host is ignored during tenant scan and will not be routable

If a host config is malformed or invalid, that host is excluded from routing during scan, and the scanner writes a structured error file at `src/config.validation.error.json` inside that host folder. Other hosts continue scanning normally.

## Host Labels

Each tenant host is resolved as:

```text
<subdomain>.<domain>
```

Examples:

- `www.example.com`
- `api.example.com`

The resolved host label is also used to name tenant processes such as `tenant_www.example.com`.

When the requested host does not have an exact tenant host match, the default tenancy adapter also retries it as `www.<requested-host>`. That means a tenant created as `www.example.com` is also reachable through `example.com`, and a scaffolded `www.localhost` host is also reachable through `localhost`.

## Route Definitions

Routes are read from the `routesAvailable` property in the merged host config. Each entry maps a URI pattern to route metadata.
The optional host-level `methodsAvailable` array is checked before any matched route-level `methods` array.
If either property is omitted, it falls back to `["GET"]`.

Static example:

```json
{
  "methodsAvailable": ["GET"],
  "routesAvailable": {
    "/": {
      "methods": ["GET", "HEAD"],
      "content-types": [],
      "controller": "controllers/home.js",
      "call": "index"
    }
  }
}
```

Dynamic example:

```json
{
  "methodsAvailable": ["GET", "POST"],
  "routesAvailable": {
    "/blog/{slug}": {
      "methods": ["GET"],
      "content-types": [],
      "controller": "controllers/blog.js",
      "call": "show",
      "cache": "no-cache"
    }
  }
}
```

Dynamic placeholders use `{name}` syntax. During matching, the route compiler turns those patterns into regular expressions and replaces placeholder references in string route values.

## Route Fields Consumed by Ehecatl

The current `TenantRoute` class accepts these fields:

- `asset`
- `i18n`
- `controller`
- `call`
- `cache`
- `session`
- `redirect`
- `status`
- `methodsAvailable`
- `methods`
- `contentTypes` from config key `"content-types"`
- `uploadPath`
- `uploadTypes`
- `maxInputBytes`
- `host`
- `domain`
- `subdomain`
- `rootFolder`
- `appRootFolder`
- `publicRootFolder`

Not every field is fully exercised by the bundled pipeline, but these are the fields the route object currently understands.

## Static Assets

If a route resolves to an `asset` and does not set `i18n`, the route is treated as a static asset route. The tenant route resolves the absolute file path from the tenant `src/public` tree.

## Redirects and Aliases

The tenancy adapter also supports domain-level alias files. When a domain entry in the tenants root is a file instead of a directory, it is parsed as alias configuration. Alias entries can:

- redirect directly,
- point one host label at another tenant host.

Alias entries may also define:

- `aliasEnabled`: when set to `false`, the alias entry is ignored during tenant scan

Successful tenancy rescans also invalidate the shared route and response-cache keys. When an enabled host changes, the manager asks the main process to reload only the affected `tenant_*` process. That change detection includes both `src/config.json` updates and `src/app/index.js` modification-time changes. When a host disappears or becomes disabled, the manager asks the main process to stop that tenant process.

## Tenant Controller Loading

When the engine needs controller execution, it sends the route and request to the target `tenant_*` process. That process:

- resolves the controller path relative to `<tenantRoot>/src/app`,
- caches the module by resolved path and reloads it when the source-file modification time changes,
- chooses the handler by explicit `call`, `default`, or module export function,
- passes a context containing the route, request, tenant metadata, and shared services.

## Operational Policy

Runtime policy controls tenant ownership and access rules for:

- domain base folders,
- host folders,
- manager read access,
- engine read and write access,
- per-tenant process user naming.

See [Runtime Policy](../reference/runtime-policy.md) for the operational side of tenancy.
