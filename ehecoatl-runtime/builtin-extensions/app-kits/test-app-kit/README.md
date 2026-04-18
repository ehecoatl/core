# Test App Kit

This app kit is the built-in live demo for:

- static asset routes
- `.e.htm` template rendering with route-level `i18n`
- `@markdown(...)` directives inside templates
- browser WebSocket consumption on the public `/ws` route
- middleware-only session, auth, csrf, and route-driven CORS examples

Main demo URLs after deploy:

- `/htm/index.htm`
- `/htm/template-basic.e.htm`
- `/htm/template-layout.e.htm`
- `/action/template?name=Ana`
- `/htm/ws-live.htm`
- `/auth/session`
- `/auth/login`
- `/auth/admin`
- `/cors/open`

WebSocket demo behavior:

- `index.js` starts a background ticker in `boot()`
- every second it asks `services.ws.listChannels()`
- if any concrete channels for the app are open, it broadcasts a JSON tick message to each one
- if no channels are open, the tick cycle is a no-op

## Isolated Runtime Context

This app kit runs inside the isolated runtime, which passes the same `services` object to:

- `index.js` `boot(context)`
- HTTP actions under `app/http/actions`
- WS actions under `app/ws/actions`

Available services include:

- `storage`
- `fluentFs`
- `cache`
- `rpc`
- `ws`

`services.fluentFs` is the preferred way to assemble runtime paths:

```js
services.fluentFs.app.http.actions.path(`hello.js`);
services.fluentFs.assets.static.htm.path(`index.htm`);
services.fluentFs.storage.uploads.path(`file.txt`);
```

Path fallback behavior:

- `app` resolves app-local first, then tenant shared `shared/app`
- `assets` resolves app-local first, then tenant shared `shared/assets`
- `storage` stays app-local only

Suggested smoke flow:

1. Load `/htm/index.htm`
2. Open `/htm/template-basic.e.htm`
3. Open `/htm/template-layout.e.htm`
4. Open `/action/template?name=Ana`
5. Open `/htm/ws-live.htm`
6. Confirm the page receives one JSON message per second while connected to `/ws`

## Action Template Rendering

The route `/action/template` demonstrates first-class template rendering from an HTTP action response.

The action returns:

```js
{
  status: 200,
  render: {
    template: `static/htm/action-template.e.htm`,
    view: {
      title: `Action Template Response`
    },
    i18n: [
      `assets/i18n/action-template.override.json`
    ]
  }
}
```

That response is rendered by the normal HTTP action middleware path, not by a separate asset route.
