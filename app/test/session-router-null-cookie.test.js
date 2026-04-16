// test/session-router-null-cookie.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const RequestData = require(`g@/engine/network-engine/execution/request-data`);
const Network2SessionResolver = require(`g@/engine/network-engine/network2session-resolver`);
const SessionRouter = require(`g@/engine/session-router/session-router`);

function createPluginHooks() {
  return {
    ENGINE: {
      REQUEST: {
        AUTH_CSRF: { BEFORE: 101, AFTER: 102, ERROR: 103 },
        GET_SESSION: { BEFORE: 104, AFTER: 105, ERROR: 106 }
      },
      RESPONSE: {
        UPDATE_COOKIE: { BEFORE: 107, AFTER: 108, ERROR: 109 },
        UPDATE_SESSION: { BEFORE: 110, AFTER: 111, ERROR: 112 }
      },
      SESSION: {
        AUTH_CSRF: { BEFORE: 1, AFTER: 2, ERROR: 3 },
        GET_SESSION: { BEFORE: 4, AFTER: 5, ERROR: 6 },
        UPDATE_COOKIE: { BEFORE: 7, AFTER: 8, ERROR: 9 },
        UPDATE_SESSION: { BEFORE: 10, AFTER: 11, ERROR: 12 },
        CACHE_SET: { BEFORE: 13, AFTER: 14, ERROR: 15 },
        CACHE_GET: { BEFORE: 16, AFTER: 17, ERROR: 18 },
        CREATE: { BEFORE: 19, AFTER: 20, ERROR: 21 }
      }
    }
  };
}

function createKernelContext(sharedCacheService) {
  return {
    config: {
      _adapters: {
        sessionRouter: require.resolve(`@/adapters/engine/session-router/default-session`)
      },
      sessionRouter: {
        cacheTTL: 3600000
      }
    },
    plugin: {
      hooks: createPluginHooks(),
      async run() {}
    },
    gateways: {
      sharedCacheService
    }
  };
}

test(`RequestData normalizes missing cookie headers to an empty object`, () => {
  const requestData = new RequestData({
    method: `get`,
    url: `/hello`,
    headers: {}
  });

  assert.deepEqual(requestData.cookie, {});
});

test(`SessionRouter getSessionData returns an empty session when cookie is null`, async () => {
  let cacheGetCalls = 0;
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      cacheGetCalls += 1;
      return null;
    },
    async set() {}
  }));

  const sessionData = await sessionRouter.getSessionData({
    tenantRoute: { host: `www.fakedomain.com` },
    cookie: null
  });

  assert.deepEqual(sessionData, {});
  assert.equal(cacheGetCalls, 0);
});

test(`SessionRouter getSessionData refreshes session ttl on cache hits`, async () => {
  const writes = [];
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      return JSON.stringify({
        userId: 55,
        csrfToken: `csrf-existing`
      });
    },
    async set(label, value, ttl) {
      writes.push({ label, value, ttl });
    }
  }));

  const sessionData = await sessionRouter.getSessionData({
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    cookie: {
      session: `session-123`
    }
  });

  assert.deepEqual(sessionData, {
    userId: 55,
    csrfToken: `csrf-existing`
  });
  assert.deepEqual(writes, [{
    label: `session:www.fakedomain.com:session-123`,
    value: JSON.stringify({
      userId: 55,
      csrfToken: `csrf-existing`
    }),
    ttl: 3600000
  }]);
});

test(`SessionRouter setSessionData creates and persists a new session when cookie is missing`, async () => {
  const cookie = {};
  const writes = [];
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      throw new Error(`session writes should not reload stale cache state`);
    },
    async set(label, value, ttl) {
      writes.push({ label, value, ttl });
    }
  }));

  const updated = await sessionRouter.setSessionData({
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    cookie,
    sessionData: { userId: 123 }
  });

  assert.equal(updated, true);
  assert.equal(typeof cookie.session, `string`);
  assert.equal(typeof cookie.csrfToken, `string`);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].label, `session:www.fakedomain.com:${cookie.session}`);
  assert.equal(writes[0].ttl, 3600000);
  assert.deepEqual(JSON.parse(writes[0].value), {
    userId: 123,
    csrfToken: cookie.csrfToken
  });
});

test(`SessionRouter cookiesResponse creates a new session when cookie is null`, async () => {
  const writes = [];
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      return null;
    },
    async set(label, value, ttl) {
      writes.push({ label, value, ttl });
    }
  }));

  const setCookie = await sessionRouter.cookiesResponse({
    tenantRoute: { host: `www.fakedomain.com` },
    cookie: null
  });

  assert.equal(typeof setCookie.session.value, `string`);
  assert.equal(typeof setCookie.csrfToken.value, `string`);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].label, `session:www.fakedomain.com:${setCookie.session.value}`);
  assert.equal(writes[0].ttl, 3600000);
  assert.deepEqual(JSON.parse(writes[0].value), {
    csrfToken: setCookie.csrfToken.value
  });
});

test(`SessionRouter cookiesResponse reuses the current request session identity without rewriting cache`, async () => {
  const writes = [];
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      return null;
    },
    async set(label, value, ttl) {
      writes.push({ label, value, ttl });
    }
  }));
  const cookie = {};
  const sessionData = { userId: 7 };

  await sessionRouter.setSessionData({
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    cookie,
    sessionData
  });

  const setCookie = await sessionRouter.cookiesResponse({
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    cookie,
    sessionData,
    persist: false
  });

  assert.equal(writes.length, 1);
  assert.equal(setCookie.session.value, cookie.session);
  assert.equal(setCookie.csrfToken.value, cookie.csrfToken);
});

test(`SessionRouter setSessionData throws when shared-cache persistence fails`, async () => {
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      return null;
    },
    async set() {
      throw new Error(`cache unavailable`);
    }
  }));

  await assert.rejects(() => sessionRouter.setSessionData({
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    cookie: {},
    sessionData: { userId: 99 }
  }), /Failed to persist session data/);
});

test(`Network2SessionResolver keeps live session data and response cookies consistent for new sessions`, async () => {
  const writes = [];
  const plugin = {
    hooks: createPluginHooks(),
    async run() {}
  };
  const sessionRouter = new SessionRouter({
    config: {
      _adapters: {
        sessionRouter: require.resolve(`@/adapters/engine/session-router/default-session`)
      },
      sessionRouter: {
        cacheTTL: 3600000
      }
    },
    plugin,
    gateways: {
      sharedCacheService: {
        async get() {
          return null;
        },
        async set(label, value, ttl) {
          writes.push({ label, value, ttl });
        }
      }
    }
  });
  const resolver = new Network2SessionResolver({
    plugin,
    sessionRouter
  });
  const executionContext = {
    tenantRoute: { host: `www.fakedomain.com`, session: true },
    requestData: { cookie: {} },
    responseData: { cookie: null },
    sessionData: { userId: 77 }
  };

  await resolver.updateSessionData(executionContext);
  await resolver.setCookiesSession(executionContext);

  assert.equal(writes.length, 1);
  assert.equal(typeof executionContext.requestData.cookie.session, `string`);
  assert.equal(typeof executionContext.requestData.cookie.csrfToken, `string`);
  assert.equal(executionContext.responseData.cookie.session.value, executionContext.requestData.cookie.session);
  assert.equal(executionContext.responseData.cookie.csrfToken.value, executionContext.requestData.cookie.csrfToken);
  assert.deepEqual(JSON.parse(writes[0].value), {
    userId: 77,
    csrfToken: executionContext.requestData.cookie.csrfToken
  });
});

test(`SessionRouter authCSRF returns unsuccessful when cookie is null`, async () => {
  let cacheGetCalls = 0;
  const sessionRouter = new SessionRouter(createKernelContext({
    async get() {
      cacheGetCalls += 1;
      return null;
    },
    async set() {}
  }));

  const authResult = await sessionRouter.authCSRF({
    tenantRoute: { host: `www.fakedomain.com` },
    cookie: null
  });

  assert.deepEqual(authResult, { success: false });
  assert.equal(cacheGetCalls, 0);
});
