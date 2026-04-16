# Test App Kit

This app kit is the built-in live demo for:

- static asset routes
- `.e.htm` template rendering with route-level `i18n`
- browser WebSocket consumption on the public `/ws` route

Main demo URLs after deploy:

- `/htm/index.htm`
- `/htm/template-basic.e.htm`
- `/htm/template-layout.e.htm`
- `/htm/ws-live.htm`

WebSocket demo behavior:

- `index.js` starts a background ticker in `boot()`
- every second it asks `services.ws.listChannels()`
- if any concrete channels for the app are open, it broadcasts a JSON tick message to each one
- if no channels are open, the tick cycle is a no-op

Suggested smoke flow:

1. Load `/htm/index.htm`
2. Open `/htm/template-basic.e.htm`
3. Open `/htm/template-layout.e.htm`
4. Open `/htm/ws-live.htm`
5. Confirm the page receives one JSON message per second while connected to `/ws`
