// test/uws-response-writing.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const { PassThrough } = require(`node:stream`);

const writeHttpResponse = require(`@/adapters/engine/network-engine/uws/uws-http-write-response`);
const createTokenBucketLimiter = require(`@/utils/limiter/request-limiter-http`);
const { toStatusLine } = require(`@/utils/http/http-response-write`);

function createMockUwsResponse() {
  const events = [];
  let insideCork = false;

  return {
    events,
    cork(callback) {
      events.push({ type: `cork:start` });
      insideCork = true;
      callback();
      insideCork = false;
      events.push({ type: `cork:end` });
      return this;
    },
    writeStatus(status) {
      events.push({ type: `writeStatus`, status, insideCork });
      return this;
    },
    writeHeader(key, value) {
      events.push({ type: `writeHeader`, key, value, insideCork });
      return this;
    },
    write(chunk) {
      events.push({ type: `write`, chunk: Buffer.from(chunk).toString(), insideCork });
      return true;
    },
    end(body) {
      events.push({
        type: `end`,
        body: body == null ? null : Buffer.from(body).toString(),
        insideCork
      });
      return this;
    },
    onWritable(handler) {
      this.onWritableHandler = handler;
      events.push({ type: `onWritable` });
      return this;
    },
    onAborted(handler) {
      this.onAbortedHandler = handler;
      events.push({ type: `onAborted` });
      return this;
    }
  };
}

function createExecutionContext(responseData, res) {
  return {
    responseData,
    tenantRoute: null,
    manager: {
      setCookiesSession: async () => {}
    },
    res,
    hooks: {
      RESPONSE: {
        WRITE: {
          START: `response.write.start`,
          ERROR: `response.write.error`,
          BREAK: `response.write.break`,
          END: `response.write.end`
        }
      }
    },
    async run() {},
    isAborted() {
      return false;
    }
  };
}

test(`toStatusLine expands numeric statuses into full status lines`, () => {
  assert.equal(toStatusLine(200), `200 OK`);
  assert.equal(toStatusLine(`404`), `404 Not Found`);
  assert.equal(toStatusLine(`422 Unprocessable Content`), `422 Unprocessable Content`);
});

test(`writeHttpResponse corks status, headers, and string bodies`, async () => {
  const res = createMockUwsResponse();
  const executionContext = createExecutionContext({
    status: 201,
    headers: { 'X-Test': `yes` },
    body: `hello`
  }, res);

  await writeHttpResponse(executionContext);

  assert.deepEqual(
    res.events.filter((event) => event.type === `writeStatus`).map((event) => event.status),
    [`201 Created`]
  );
  assert.ok(
    res.events
      .filter((event) => [`writeStatus`, `writeHeader`, `end`].includes(event.type))
      .every((event) => event.insideCork),
    `expected all response writes to happen inside cork()`
  );
});

test(`writeHttpResponse adds a JSON content type when serializing objects`, async () => {
  const res = createMockUwsResponse();
  const executionContext = createExecutionContext({
    status: 200,
    headers: {},
    body: { ok: true }
  }, res);

  await writeHttpResponse(executionContext);

  assert.deepEqual(
    res.events.filter((event) => event.type === `writeHeader`).map((event) => [event.key, event.value]),
    [[`Content-Type`, `application/json`]]
  );
  assert.deepEqual(
    res.events.filter((event) => event.type === `end`).map((event) => event.body),
    [`{"ok":true}`]
  );
});

test(`writeHttpResponse corks streamed response head and chunks`, async () => {
  const res = createMockUwsResponse();
  const body = new PassThrough();
  const executionContext = createExecutionContext({
    status: 200,
    headers: { 'Content-Type': `text/plain; charset=utf-8` },
    body
  }, res);

  await writeHttpResponse(executionContext);
  body.write(`hello`);
  body.end(` world`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(res.events.some((event) => event.type === `onWritable`));
  assert.deepEqual(
    res.events.filter((event) => event.type === `write`).map((event) => event.chunk),
    [`hello`, ` world`]
  );
  assert.ok(
    res.events
      .filter((event) => [`writeStatus`, `writeHeader`, `write`, `end`].includes(event.type))
      .every((event) => event.insideCork),
    `expected streamed writes to happen inside cork()`
  );
});

test(`request limiter corks blocked uWS responses`, async () => {
  const limiter = createTokenBucketLimiter({
    capacity: 0,
    refillRateSeconds: 0
  });
  const res = createMockUwsResponse();
  let nextCalled = false;

  await limiter(`127.0.0.1`, res, async () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.deepEqual(
    res.events.filter((event) => event.type === `writeStatus`).map((event) => event.status),
    [`429 Too Many Requests`]
  );
  assert.ok(
    res.events
      .filter((event) => [`writeStatus`, `writeHeader`, `end`].includes(event.type))
      .every((event) => event.insideCork),
    `expected limiter response writes to happen inside cork()`
  );
});
