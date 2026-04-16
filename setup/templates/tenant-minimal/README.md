# Minimal Tenant Template

This template defines the first smoke-test tenant shape for Ehecatl.

Only `host/src/config.json` is consumed by the tenancy scanner. A domain-level `config.json` is not part of the runtime contract.

Expected host routes:

- `/` redirects to `/htm/index.htm`
- `/htm/{filename}.htm` serves `src/public/htm/{filename}.htm`
- `/session` executes `src/app/controllers/sessionController.js#index` with `session: true`
- `/post-data` executes `src/app/controllers/postDataController.js#index` for POST request-body examples
- `/{controller}` executes `src/app/controllers/{controller}Controller.js#index`

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

Template structure:

- `host/src/config.json`
- `host/src/app/index.js`
- `host/src/app/controllers/helloController.js`
- `host/src/app/controllers/postDataController.js`
- `host/src/app/controllers/sessionController.js`
- `host/src/public/htm/index.htm`
- `host/src/public/htm/cached.htm`
