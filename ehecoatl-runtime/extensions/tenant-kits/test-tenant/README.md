# Minimal Tenant Kit

This tenant kit defines the first smoke-test tenant shape for Ehecoatl.

`config.json` is copied to the opaque tenant root (`tenant_{tenant_id}`) and patched with `tenantId` plus `tenantDomain`. `app/config.json` is copied into the opaque app root (`app_{app_id}`) and patched with `appId` plus `appName`, then consumed by the tenancy scanner for app-level settings. Any `.json` files under `app/routes/` are merged into the app's `routesAvailable` set during scan.

Expected app routes:

- `/` redirects to `/htm/index.htm`
- `/htm/{filename}.htm` serves `assets/htm/{filename}.htm`
- `/session` executes `pointsTo: "run > session@index"` with `session: true`
- `/post-data` executes `pointsTo: "run > post-data@index"` for POST request-body examples
- `/{action}` executes `pointsTo: "run > {action}@index"`

Expected smoke responses:

- `GET /` returns a redirect to `/htm/index.htm`
- `GET /htm/index.htm` returns `200` with the HTML hello-world page
- `GET /htm/cached.htm` returns `200` with the cacheable HTML example page
- `GET /session` returns `200` with JSON containing:
  - `message: "session hello world"`
  - `sessionId: "<session cookie value or null>"`
  - `sessionData: "<loaded session payload object>"`
  - `timestampUtc: "<current UTC ISO timestamp>"`
- `POST /post-data` returns `200` with JSON containing:
  - `message: "post data received"`
  - `method: "POST"`
  - `dataReceived: "<parsed request body object>"`
  - `timestampUtc: "<current UTC ISO timestamp>"`
- `GET /hello` returns `200` with JSON containing:
- `message: "hello world"`
  - `timestampUtc: "<current UTC ISO timestamp>"`

Kit structure:

- `config.json`
- `.ehecoatl/`
- `.ehecoatl/lib/nginx.e.conf`
- `shared/config/`
- `shared/app/http/middlewares/`
- `shared/app/ws/middlewares/`
- `shared/plugins/`
- `shared/routes/`
- `app/config.json`
- `app/index.js`
- `app/actions/hello.js`
- `app/actions/post-data.js`
- `app/actions/session.js`
- `app/http/middlewares/`
- `app/ws/middlewares/`
- `app/routes/base.json`
- `app/assets/htm/index.htm`
- `app/assets/htm/cached.htm`
- `app/.ehecoatl/.backups`
- `app/.ehecoatl/.cache`
- `app/.ehecoatl/.lib`
- `app/.ehecoatl/.log`
- `app/.ehecoatl/.spool`
- `app/.ehecoatl/.ssh`
- `app/.ehecoatl/.tmp`

The `.ehecoatl/` folder groups tenant-local system files into one place so the app root stays cleaner and operational directories are clearly separated from application code and assets.

`nginx.e.conf` is the tenant-owned nginx vhost template. The web-server service clones it into nginx-managed config on every source update, replacing runtime tokens while preserving tenant customizations.

Custom tenant/app HTTP middleware scripts belong under the corresponding `http/middlewares/` folders. Route fragments belong under `app/routes/`, where each `.json` file can define part of the app route map and will be merged into `routesAvailable` during tenant scan.

Tenant route targets now use a single `pointsTo` field. Supported forms are:

- `run > {resource}@{action}`
- `asset > relative/file.ext`
- `redirect > /some/path`
- `redirect 301 > https://example.com`

Spaces around `>` are allowed, but the bundled examples use the normalized `type > target` form.

The bundled `config.json` sets the default domain routing contract for new tenants:

- `tenantId`: opaque 12-character tenant identifier injected at creation time
- `tenantDomain`: human-readable domain identity used for routing
- `appRoutingMode`: `subdomain` or `path`
- `defaultAppName`: default app fallback for that domain
