'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const MiddlewareStackOrchestrator = require(`@/_core/orchestrators/middleware-stack-orchestrator`);
const TenantRoute = require(`@/_core/runtimes/ingress-runtime/execution/tenant-route`);

test(`middleware-stack-orchestrator composes core stack order and route stack app-over-tenant resolution`, async () => {
  const executionTrace = [];
  const pluginTrace = [];
  const executionContext = createExecutionContext({
    tenantRoute: createTenantRoute({
      middleware: [`web`],
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    })
  });

  const orchestrator = createOrchestrator({
    pluginTrace,
    resolver: {
      getCoreMiddlewareOrder() {
        return [`core-a`, `core-b`];
      },
      getCoreMiddlewares() {
        return {
          'core-a': async (context, next) => {
            executionTrace.push([`core-a-before`, context === executionContext]);
            await next();
            executionTrace.push([`core-a-after`, context === executionContext]);
          },
          'core-b': async (context, next) => {
            executionTrace.push([`core-b-before`, context === executionContext]);
            await next();
            executionTrace.push([`core-b-after`, context === executionContext]);
          }
        };
      },
      getTenantMiddlewares() {
        return {
          http: {
            web: async (context, next) => {
              executionTrace.push([`tenant-web`, typeof context.setStatus === `function`]);
              await next();
            }
          },
          ws: {}
        };
      },
      async loadAppMiddlewares() {
        return {
          http: {
            web: async (context, next) => {
              executionTrace.push([`app-web-before`, typeof context.setStatus === `function`, context !== executionContext]);
              await next();
              executionTrace.push([`app-web-after`, typeof context.getHeaders === `function`]);
            }
          },
          ws: {}
        };
      }
    }
  });

  await orchestrator.runHttpMiddlewareStack(executionContext);

  assert.deepEqual(executionTrace, [
    [`core-a-before`, true],
    [`core-b-before`, true],
    [`core-b-after`, true],
    [`core-a-after`, true],
    [`app-web-before`, true, true],
    [`app-web-after`, true]
  ]);
  assert.equal(executionContext.responseData.status, 200);
  assert.ok(pluginTrace.includes(`STACK_START`));
  assert.ok(pluginTrace.includes(`STACK_END`));
});

test(`middleware-stack-orchestrator stops after a core middleware short-circuits`, async () => {
  const executionTrace = [];
  const pluginTrace = [];
  const executionContext = createExecutionContext({
    tenantRoute: createTenantRoute({
      middleware: [`web`],
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    })
  });

  const orchestrator = createOrchestrator({
    pluginTrace,
    resolver: {
      getCoreMiddlewareOrder() {
        return [`core-a`, `core-b`];
      },
      getCoreMiddlewares() {
        return {
          'core-a': async (context) => {
            executionTrace.push(`core-a`);
            context.responseData.status = 204;
          },
          'core-b': async () => {
            executionTrace.push(`core-b`);
          }
        };
      },
      getTenantMiddlewares() {
        return {
          http: {
            web: async () => {
              executionTrace.push(`tenant-web`);
            }
          },
          ws: {}
        };
      },
      async loadAppMiddlewares() {
        return { http: {}, ws: {} };
      }
    }
  });

  await orchestrator.runHttpMiddlewareStack(executionContext);

  assert.deepEqual(executionTrace, [`core-a`]);
  assert.equal(executionContext.responseData.status, 204);
  assert.ok(pluginTrace.includes(`STACK_BREAK`));
});

test(`middleware-stack-orchestrator returns 500 when middleware calls next twice`, async () => {
  const pluginTrace = [];
  const executionContext = createExecutionContext({
    tenantRoute: createTenantRoute({
      middleware: null,
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    })
  });

  const orchestrator = createOrchestrator({
    pluginTrace,
    resolver: {
      getCoreMiddlewareOrder() {
        return [`core-a`];
      },
      getCoreMiddlewares() {
        return {
          'core-a': async (_, next) => {
            await next();
            await next();
          }
        };
      },
      getTenantMiddlewares() {
        return { http: {}, ws: {} };
      },
      async loadAppMiddlewares() {
        return { http: {}, ws: {} };
      }
    }
  });

  await orchestrator.runHttpMiddlewareStack(executionContext);

  assert.equal(executionContext.responseData.status, 500);
  assert.equal(executionContext.responseData.body, `Internal Server Middleware Stack Error`);
  assert.ok(pluginTrace.includes(`STACK_ERROR`));
});

test(`middleware-stack-orchestrator fails when a route middleware label cannot be resolved`, async () => {
  const pluginTrace = [];
  const executionContext = createExecutionContext({
    tenantRoute: createTenantRoute({
      middleware: [`web`],
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    })
  });

  const orchestrator = createOrchestrator({
    pluginTrace,
    resolver: {
      getCoreMiddlewareOrder() {
        return [];
      },
      getCoreMiddlewares() {
        return {};
      },
      getTenantMiddlewares() {
        return { http: {}, ws: {} };
      },
      async loadAppMiddlewares() {
        return { http: {}, ws: {} };
      }
    }
  });

  await orchestrator.runHttpMiddlewareStack(executionContext);

  assert.equal(executionContext.responseData.status, 500);
  assert.equal(executionContext.responseData.body, `Internal Server Middleware Stack Error`);
  assert.ok(pluginTrace.includes(`STACK_ERROR`));
});

test(`tenant route normalizes middleware and middlewares into one canonical middleware array`, () => {
  const canonicalRoute = createTenantRoute({
    middleware: `web`,
    tenantId: `aaaaaaaaaaaa`,
    appId: `bbbbbbbbbbbb`
  });
  const aliasRoute = new TenantRoute({
    pointsTo: `run > hello@index`,
    middlewares: [`web`, `cors`],
    origin: {
      hostname: `www.example.com`,
      domain: `example.com`,
      appName: `www`,
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    },
    folders: {
      rootFolder: `/tmp/app`,
      actionsRootFolder: `/tmp/app/actions`,
      assetsRootFolder: `/tmp/app/assets`,
      httpMiddlewaresRootFolder: `/tmp/app/http/middlewares`,
      wsMiddlewaresRootFolder: `/tmp/app/ws/middlewares`,
      routesRootFolder: `/tmp/app/routes`
    }
  });

  assert.deepEqual(canonicalRoute.middleware, [`web`]);
  assert.deepEqual(aliasRoute.middleware, [`web`, `cors`]);
  assert.equal(aliasRoute.origin.tenantId, `aaaaaaaaaaaa`);
  assert.equal(aliasRoute.origin.appId, `bbbbbbbbbbbb`);
});

function createOrchestrator({
  pluginTrace,
  resolver
}) {
  const pluginOrchestrator = {
    hooks: {
      TRANSPORT: {
        MIDDLEWARE_STACK: {
          START: `STACK_START`,
          END: `STACK_END`,
          BREAK: `STACK_BREAK`,
          ERROR: `STACK_ERROR`,
          MIDDLEWARE: {
            START: `MIDDLEWARE_START`,
            END: `MIDDLEWARE_END`,
            BREAK: `MIDDLEWARE_BREAK`,
            ERROR: `MIDDLEWARE_ERROR`
          }
        }
      }
    },
    async run(hookId) {
      pluginTrace.push(hookId);
    }
  };

  return new MiddlewareStackOrchestrator({
    config: {
      adapters: {
        middlewareStackOrchestrator: {}
      }
    },
    pluginOrchestrator,
    useCases: {
      middlewareStackResolver: resolver
    }
  });
}

function createExecutionContext({
  tenantRoute
}) {
  let aborted = false;
  let finishCallbacksCalled = 0;

  return {
    tenantRoute,
    requestData: {
      url: `www.example.com/hello`,
      method: `GET`,
      headers: {}
    },
    responseData: {
      status: 200,
      body: null,
      headers: {}
    },
    services: {},
    sessionData: {},
    meta: {
      currentMiddlewareIndex: null,
      currentMiddlewareName: null
    },
    middlewareStackOrchestratorConfig: {},
    addFinishCallback() {},
    async callFinishCallbacks() {
      finishCallbacksCalled += 1;
      return finishCallbacksCalled;
    },
    isAborted() {
      return aborted;
    },
    abort() {
      aborted = true;
    }
  };
}

function createTenantRoute({
  middleware,
  tenantId,
  appId
}) {
  return new TenantRoute({
    pointsTo: `run > hello@index`,
    middleware,
    origin: {
      hostname: `www.example.com`,
      appURL: `www.example.com`,
      domain: `example.com`,
      appName: `www`,
      tenantId,
      appId
    },
    folders: {
      rootFolder: `/tmp/app`,
      actionsRootFolder: `/tmp/app/actions`,
      assetsRootFolder: `/tmp/app/assets`,
      httpMiddlewaresRootFolder: `/tmp/app/http/middlewares`,
      wsMiddlewaresRootFolder: `/tmp/app/ws/middlewares`,
      routesRootFolder: `/tmp/app/routes`
    }
  });
}
