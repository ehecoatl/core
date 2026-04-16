// test/future-system-improvements.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const readBody = require(`@/adapters/engine/network-engine/uws/uws-http-read-body`);
const handleHttp = require(`@/adapters/engine/network-engine/uws/uws-http-handler`).handle;
const tenantControllerStage = require(`@/adapters/engine/request-pipeline/default-pipeline/stages/tenant-controller-stage`);
const localFileStreamStage = require(`@/adapters/engine/request-pipeline/default-pipeline/stages/local-file-stream-stage`);
const midSessionQueueStage = require(`@/adapters/engine/request-pipeline/default-pipeline/stages/mid-session-queue-stage`);
const cacheMaterializationStage = require(`@/adapters/engine/request-pipeline/default-pipeline/stages/response-cache-materialization-stage`);
const Network2ManagerResolver = require(`g@/engine/network-engine/network2manager-resolver`);
const Network2SessionResolver = require(`g@/engine/network-engine/network2session-resolver`);
const ExecutionMetaData = require(`g@/engine/network-engine/execution/execution-meta-data`);
const ExecutionContext = require(`g@/engine/network-engine/execution/execution-context`);
const TenantRoute = require(`g@/engine/network-engine/execution/tenant-route`);
const QueueBroker = require(`g@/manager/queue-broker/queue-broker`);
const TenancyRouter = require(`g@/manager/tenancy-router/tenancy-router`);
const RpcEndpoint = require(`g@/shared/rpc/rpc-endpoint`);
const SharedCacheService = require(`g@/shared/shared-cache/shared-cache-service`);
const MessageSchema = require(`g@/shared/rpc/schemas/message-schema`);
const queueBrokerAdapter = require(`@/adapters/manager/queue-broker/event-memory`);
const defaultTenancyAdapter = require(`@/adapters/manager/tenancy-router/default-tenancy`);
const loggerRuntime = require(`@/plugins/logger-runtime`);
const processFirewallPlugin = require(`@/plugins/process-firewall`);
const { createHourlyFileLogger } = require(`@/utils/logger/hourly-file-logger`);
const { classifyRequestLatency } = require(`@/utils/observability/request-latency-classifier`);
const { createTenantReportWriter } = require(`@/utils/observability/tenant-report-writer`);
const {
  MAX_CHAIN_NAME_LENGTH,
  SHORT_INPUT_PREFIX,
  resolveInboundFirewallChainName
} = require(`@/utils/security/firewall-chain-name`);
const { handleTenantControllerRequest } = require(`@/bootstrap/bootstrap-tenant-app`);

test(`readBody rejects structured CSRF failures before body parsing continues`, async () => {
  let onDataRegistered = false;
  const executionContext = {
    networkEngine: {
      requestPipeline: {
        config: {},
        maxInputBytes: `1MB`
      }
    },
    requestData: {
      headers: {
        'content-length': `12`,
        'content-type': `application/json`
      }
    },
    tenantRoute: {
      maxInputBytes: `1MB`
    },
    sessionHelper: {
      async authSessionCSRF() {
        return { success: false };
      }
    },
    res: {
      onData() {
        onDataRegistered = true;
      }
    }
  };

  await assert.rejects(() => readBody(executionContext), /401 Unauthorized/);
  assert.equal(onDataRegistered, false);
});

test(`tenant controller stage preserves tenant-provided failure status and body`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {},
    cookie: null
  };
  const stageContext = {
    tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
    requestData: { url: `tenant.test/missing` },
    sessionData: {},
    services: {
      rpc: {
        async ask() {
          return {
            success: false,
            status: 404,
            body: `Controller not found`,
            headers: { 'Content-Type': `text/plain; charset=utf-8` }
          };
        }
      }
    },
    setStatus(status) {
      responseData.status = status;
    },
    setBody(body) {
      responseData.body = body;
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setCookie() {
      throw new Error(`cookie should not be set`);
    }
  };

  const continuePipeline = await tenantControllerStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.equal(responseData.status, 404);
  assert.equal(responseData.body, `Controller not found`);
  assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
});

test(`tenant controller stage preserves tenant-provided failure headers and cookies`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {},
    cookie: {}
  };
  const stageContext = {
    tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
    requestData: { url: `tenant.test/failure` },
    sessionData: {},
    services: {
      rpc: {
        async ask() {
          return {
            success: false,
            status: 500,
            body: `Tenant failure`,
            headers: { 'X-Tenant-Error': `controller-failed` },
            cookie: {
              traceId: {
                value: `abc123`,
                httpOnly: true,
                path: `/`
              }
            }
          };
        }
      }
    },
    setStatus(status) {
      responseData.status = status;
    },
    setBody(body) {
      responseData.body = body;
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setCookie(key, value) {
      responseData.cookie[key] = value;
    }
  };

  const continuePipeline = await tenantControllerStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.equal(responseData.status, 500);
  assert.equal(responseData.body, `Tenant failure`);
  assert.equal(responseData.headers[`X-Tenant-Error`], `controller-failed`);
  assert.deepEqual(responseData.cookie.traceId, {
    value: `abc123`,
    httpOnly: true,
    path: `/`
  });
});

test(`tenant controller stage uses a non-production fallback body when tenant RPC fails`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = `development`;

  try {
    const responseData = {
      status: 200,
      body: null,
      headers: {}
    };
    const stageContext = {
      tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
      requestData: { url: `tenant.test/failure` },
      sessionData: {},
      services: {
        rpc: {
          async ask() {
            throw new Error(`tenant unavailable`);
          }
        }
      },
      setStatus(status) {
        responseData.status = status;
      },
      setBody(body) {
        responseData.body = body;
      },
      setHeader(key, value) {
        responseData.headers[key] = value;
      },
      setCookie() {}
    };

    const continuePipeline = await tenantControllerStage(stageContext);

    assert.equal(continuePipeline, false);
    assert.equal(responseData.status, 502);
    assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
    assert.equal(
      responseData.body,
      `Tenant controller is unavailable in this non-production environment. See runtime logs for details.`
    );
  } finally {
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`tenant controller stage records controller execution metadata from detailed RPC responses`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {},
    cookie: {}
  };
  const meta = new ExecutionMetaData();
  meta.requestId = `req-controller-01`;
  meta.correlationId = `req-controller-01`;
  let rpcRequest = null;
  const stageContext = {
    tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
    requestData: { url: `tenant.test/hello`, requestId: `req-controller-01` },
    sessionData: {},
    meta,
    services: {
      rpc: {
        async askDetailed(request) {
          rpcRequest = request;
          return {
            data: {
              status: 200,
              body: `Hello from tenant`
            },
            internalMeta: {
              controllerMeta: {
                coldWaitMs: 18,
                controllerMs: 42
              }
            }
          };
        }
      }
    },
    setStatus(status) {
      responseData.status = status;
    },
    setBody(body) {
      responseData.body = body;
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setCookie(key, value) {
      responseData.cookie[key] = value;
    }
  };

  const continuePipeline = await tenantControllerStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.equal(meta.controller, true);
  assert.deepEqual(rpcRequest.internalMeta, {
    requestId: `req-controller-01`,
    correlationId: `req-controller-01`
  });
  assert.deepEqual(meta.controllerMeta, {
    coldWaitMs: 18,
    controllerMs: 42
  });
  assert.equal(responseData.status, 200);
  assert.equal(responseData.body, `Hello from tenant`);
});

test(`tenant app controller handling returns 404 when the controller module is missing`, async () => {
  const response = await handleTenantControllerRequest({
    tenantRoute: {
      controller: `controllers/missing.js`,
      call: `show`
    },
    requestData: { url: `tenant.test/missing` },
    sessionData: {},
    tenantAppPath: `/tmp/non-existent-tenant-app`,
    tenantRoot: `/tmp/non-existent-tenant`,
    tenantLabel: `tenant_tenant.test`,
    tenantApp: null,
    services: {},
    controllerCache: new Map()
  });

  assert.equal(response.success, false);
  assert.equal(response.status, 404);
  assert.equal(response.body, `Controller not found`);
  assert.equal(response.error.controllerId, `controllers/missing.js`);
});

test(`tenant app controller handling returns 500 for an invalid controller handler`, async () => {
  const tempRoot = path.join(process.cwd(), `.tmp-invalid-controller-handler`);
  const tenantAppPath = path.join(tempRoot, `src`, `app`);
  const controllerPath = path.join(tenantAppPath, `controllers`, `invalid.js`);
  require(`fs`).mkdirSync(path.dirname(controllerPath), { recursive: true });
  require(`fs`).writeFileSync(controllerPath, `module.exports = { notAHandler: true };\n`);

  try {
    const response = await handleTenantControllerRequest({
      tenantRoute: {
        controller: `controllers/invalid.js`,
        call: `show`
      },
      requestData: { url: `tenant.test/invalid-handler` },
      sessionData: {},
      tenantAppPath,
      tenantRoot: tempRoot,
      tenantLabel: `tenant_tenant.test`,
      tenantApp: null,
      services: {},
      controllerCache: new Map()
    });

    assert.equal(response.success, false);
    assert.equal(response.status, 500);
    assert.equal(response.body, `Invalid controller handler`);
    assert.deepEqual(response.error, {
      controllerId: `controllers/invalid.js`,
      call: `show`
    });
  } finally {
    delete require.cache[require.resolve(controllerPath)];
    require(`fs`).rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`tenant app controller handling returns 500 when controller loading fails for non-missing errors`, async () => {
  const tempRoot = path.join(process.cwd(), `.tmp-controller-load-failure`);
  const tenantAppPath = path.join(tempRoot, `src`, `app`);
  const controllerPath = path.join(tenantAppPath, `controllers`, `broken.js`);
  require(`fs`).mkdirSync(path.dirname(controllerPath), { recursive: true });
  require(`fs`).writeFileSync(controllerPath, `throw new Error('broken controller load');\n`);

  try {
    const response = await handleTenantControllerRequest({
      tenantRoute: {
        controller: `controllers/broken.js`,
        call: `show`
      },
      requestData: { url: `tenant.test/broken-controller` },
      sessionData: {},
      tenantAppPath,
      tenantRoot: tempRoot,
      tenantLabel: `tenant_tenant.test`,
      tenantApp: null,
      services: {},
      controllerCache: new Map()
    });

    assert.equal(response.success, false);
    assert.equal(response.status, 500);
    assert.equal(response.body, `Controller load failure`);
    assert.equal(response.error.controllerId, `controllers/broken.js`);
    assert.match(response.error.error, /broken controller load/);
  } finally {
    delete require.cache[require.resolve(controllerPath)];
    require(`fs`).rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`tenant controller stage keeps the generic gateway body in production`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = `production`;

  try {
    const responseData = {
      status: 200,
      body: null,
      headers: {}
    };
    const stageContext = {
      tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
      requestData: { url: `tenant.test/failure` },
      sessionData: {},
      services: {
        rpc: {
          async ask() {
            throw new Error(`tenant unavailable`);
          }
        }
      },
      setStatus(status) {
        responseData.status = status;
      },
      setBody(body) {
        responseData.body = body;
      },
      setHeader(key, value) {
        responseData.headers[key] = value;
      },
      setCookie() {}
    };

    const continuePipeline = await tenantControllerStage(stageContext);

    assert.equal(continuePipeline, false);
    assert.equal(responseData.status, 502);
    assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
    assert.equal(responseData.body, `Bad Gateway`);
  } finally {
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`tenant controller stage retries once for idempotent methods after transport failure`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {}
  };
  let askCalls = 0;
  const stageContext = {
    tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
    requestData: { method: `GET`, url: `tenant.test/retry` },
    sessionData: {},
    requestPipelineConfig: {
      controllerRetryOnProcessRespawn: {
        enabled: true,
        maxAttempts: 1,
        methods: [`GET`, `HEAD`],
        retryDelayMs: 0
      }
    },
    services: {
      rpc: {
        async askDetailed() {
          askCalls += 1;
          if (askCalls === 1) {
            throw new Error(`tenant process exited`);
          }
          return {
            data: {
              status: 200,
              body: `Retry success`
            },
            internalMeta: null
          };
        }
      }
    },
    setStatus(status) {
      responseData.status = status;
    },
    setBody(body) {
      responseData.body = body;
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setCookie() {}
  };

  const continuePipeline = await tenantControllerStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.equal(askCalls, 2);
  assert.equal(responseData.status, 200);
  assert.equal(responseData.body, `Retry success`);
});

test(`tenant controller stage does not retry non-idempotent methods after transport failure`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = `production`;

  try {
    const responseData = {
      status: 200,
      body: null,
      headers: {}
    };
    let askCalls = 0;
    const stageContext = {
      tenantRoute: { controller: `controllers/example.js`, host: `tenant.test` },
      requestData: { method: `POST`, url: `tenant.test/no-retry` },
      sessionData: {},
      requestPipelineConfig: {
        controllerRetryOnProcessRespawn: {
          enabled: true,
          maxAttempts: 1,
          methods: [`GET`, `HEAD`],
          retryDelayMs: 0
        }
      },
      services: {
        rpc: {
          async askDetailed() {
            askCalls += 1;
            throw new Error(`tenant process exited`);
          }
        }
      },
      setStatus(status) {
        responseData.status = status;
      },
      setBody(body) {
        responseData.body = body;
      },
      setHeader(key, value) {
        responseData.headers[key] = value;
      },
      setCookie() {}
    };

    const continuePipeline = await tenantControllerStage(stageContext);

    assert.equal(continuePipeline, false);
    assert.equal(askCalls, 1);
    assert.equal(responseData.status, 502);
    assert.equal(responseData.body, `Bad Gateway`);
  } finally {
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`response cache materialization persists safe public controller output`, async () => {
  const writes = [];
  const cacheSets = [];
  const stageContext = {
    tenantRoute: {
      controller: `controllers/hello.js`,
      cache: `60000`,
      session: false,
      getCacheFilePath(url) {
        return `/tmp/ehecatl-cache/${url.replace(/\//g, `_`)}`;
      }
    },
    requestData: {
      method: `GET`,
      url: `tenant.test/hello`
    },
    services: {
      storage: {
        async createFolder(folderPath) {
          writes.push({ type: `mkdir`, folderPath });
        },
        async writeFile(filePath, body) {
          writes.push({ type: `write`, filePath, body });
        }
      },
      cache: {
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      }
    },
    getStatus() {
      return 200;
    },
    getBody() {
      return { ok: true };
    },
    getHeaders() {
      return {};
    },
    getCookies() {
      return null;
    }
  };

  const continuePipeline = await cacheMaterializationStage(stageContext);
  await flushAsyncOperations();

  assert.equal(continuePipeline, true);
  assert.deepEqual(writes, [
    {
      type: `mkdir`,
      folderPath: path.dirname(`/tmp/ehecatl-cache/tenant.test_hello.json`)
    },
    {
      type: `write`,
      filePath: `/tmp/ehecatl-cache/tenant.test_hello.json`,
      body: `{"ok":true}`
    }
  ]);
  assert.deepEqual(cacheSets, [
    {
      key: `validResponseCache:tenant.test/hello`,
      value: `/tmp/ehecatl-cache/tenant.test_hello.json`,
      ttl: 60000
    }
  ]);
});

test(`response cache materialization skips non-cacheable session routes`, async () => {
  let wrote = false;
  const stageContext = {
    tenantRoute: {
      controller: `controllers/session.js`,
      cache: `60000`,
      session: true,
      getCacheFilePath() {
        return `/tmp/should-not-write`;
      }
    },
    requestData: {
      method: `GET`,
      url: `tenant.test/session`
    },
    services: {
      storage: {
        async createFolder() {
          wrote = true;
        },
        async writeFile() {
          wrote = true;
        }
      },
      cache: {
        async set() {
          wrote = true;
        }
      }
    },
    getStatus() {
      return 200;
    },
    getBody() {
      return { ok: true };
    },
    getHeaders() {
      return {};
    },
    getCookies() {
      return null;
    }
  };

  const continuePipeline = await cacheMaterializationStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.equal(wrote, false);
});

test(`response cache materialization skips write when tenant-specific disk limit is exceeded`, async () => {
  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-disk-limit-block-`));
  const cacheSets = [];
  const writes = [];
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      rootFolder: tenantRoot,
      controller: `controllers/hello.js`,
      cache: `60000`,
      session: false,
      diskLimitBytes: 8,
      getCacheFilePath(url) {
        return path.join(tenantRoot, `cache`, `${url.replace(/\//g, `_`)}`);
      }
    },
    requestData: {
      method: `GET`,
      url: `tenant.test/hello`
    },
    requestPipelineConfig: {
      diskLimit: {
        enabled: true,
        defaultMaxBytes: `1GB`,
        trackedPaths: [`cache`],
        cleanupFirst: false
      }
    },
    services: {
      storage: {
        async listEntries(targetPath) {
          return await fs.promises.readdir(targetPath, { withFileTypes: true });
        },
        async fileStat(targetPath) {
          return await fs.promises.stat(targetPath);
        },
        async fileExists(targetPath) {
          try {
            await fs.promises.access(targetPath, fs.constants.F_OK);
            return true;
          } catch {
            return false;
          }
        },
        async deleteFile(targetPath) {
          try {
            await fs.promises.unlink(targetPath);
            return true;
          } catch (error) {
            if (error?.code === `ENOENT`) return false;
            throw error;
          }
        },
        async createFolder(folderPath) {
          writes.push({ type: `mkdir`, folderPath });
          await fs.promises.mkdir(folderPath, { recursive: true });
        },
        async writeFile(filePath, body) {
          writes.push({ type: `write`, filePath, body });
          await fs.promises.writeFile(filePath, body, `utf8`);
        }
      },
      cache: {
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      }
    },
    getStatus() {
      return 200;
    },
    getBody() {
      return `0123456789`; //10 bytes
    },
    getHeaders() {
      return {};
    },
    getCookies() {
      return null;
    }
  };

  try {
    const continuePipeline = await cacheMaterializationStage(stageContext);
    await flushAsyncOperations();
    assert.equal(continuePipeline, true);
    assert.deepEqual(writes, []);
    assert.deepEqual(cacheSets, []);
  } finally {
    fs.rmSync(tenantRoot, { recursive: true, force: true });
  }
});

test(`response cache materialization can cleanup tracked files and proceed within disk limit`, async () => {
  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-disk-limit-cleanup-`));
  const cacheSets = [];
  const writes = [];
  const deleted = [];
  const staleCacheFile = path.join(tenantRoot, `cache`, `stale.txt`);
  fs.mkdirSync(path.dirname(staleCacheFile), { recursive: true });
  fs.writeFileSync(staleCacheFile, `stale-file-contents-1234567890`, `utf8`);
  const staleDate = new Date(Date.now() - 60_000);
  fs.utimesSync(staleCacheFile, staleDate, staleDate);

  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      rootFolder: tenantRoot,
      controller: `controllers/hello.js`,
      cache: `60000`,
      session: false,
      diskLimit: {
        enabled: true,
        maxBytes: 24,
        trackedPaths: [`cache`],
        cleanupFirst: true,
        cleanupTargetRatio: 1
      },
      getCacheFilePath(url) {
        return path.join(tenantRoot, `cache`, `${url.replace(/\//g, `_`)}`);
      }
    },
    requestData: {
      method: `GET`,
      url: `tenant.test/hello`
    },
    requestPipelineConfig: {
      diskLimit: {
        enabled: true,
        defaultMaxBytes: `1GB`,
        trackedPaths: [`cache`],
        cleanupFirst: true
      }
    },
    services: {
      storage: {
        async listEntries(targetPath) {
          return await fs.promises.readdir(targetPath, { withFileTypes: true });
        },
        async fileStat(targetPath) {
          return await fs.promises.stat(targetPath);
        },
        async fileExists(targetPath) {
          try {
            await fs.promises.access(targetPath, fs.constants.F_OK);
            return true;
          } catch {
            return false;
          }
        },
        async deleteFile(targetPath) {
          try {
            await fs.promises.unlink(targetPath);
            deleted.push(targetPath);
            return true;
          } catch (error) {
            if (error?.code === `ENOENT`) return false;
            throw error;
          }
        },
        async createFolder(folderPath) {
          writes.push({ type: `mkdir`, folderPath });
          await fs.promises.mkdir(folderPath, { recursive: true });
        },
        async writeFile(filePath, body) {
          writes.push({ type: `write`, filePath, body });
          await fs.promises.writeFile(filePath, body, `utf8`);
        }
      },
      cache: {
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      }
    },
    getStatus() {
      return 200;
    },
    getBody() {
      return `0123456789`; //10 bytes
    },
    getHeaders() {
      return {};
    },
    getCookies() {
      return null;
    }
  };

  try {
    const continuePipeline = await cacheMaterializationStage(stageContext);
    await flushAsyncOperations();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(continuePipeline, true);
    assert.equal(deleted.includes(staleCacheFile), true);
    assert.equal(writes.some((entry) => entry.type === `write`), true);
    assert.equal(cacheSets.length, 1);
  } finally {
    fs.rmSync(tenantRoot, { recursive: true, force: true });
  }
});

test(`route resolution writes back cache on a manager miss and reuses it on the next lookup`, async () => {
  const cacheSets = [];
  let cacheReads = 0;
  let rpcCalls = 0;
  const rpcRequests = [];
  const resolver = new Network2ManagerResolver({
    config: {
      question: {
        tenancyRouter: `tenancyRouter`
      },
      tenancyRouter: {
        routeMissTTL: 5000
      }
    },
    routeCacheTTL: 60000,
    services: {
      cache: {
        async get(key) {
          cacheReads += 1;
          if (key.startsWith(`urlRouteMiss:`)) return null;
          return cacheReads === 2 ? null : JSON.stringify({
            host: `tenant.test`,
            rootFolder: `/tmp/tenant`,
            controller: `controllers/hello.js`
          });
        },
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      },
      rpc: {
        async ask(request) {
          rpcCalls += 1;
          rpcRequests.push(request);
          return {
            host: `tenant.test`,
            rootFolder: `/tmp/tenant`,
            controller: `controllers/hello.js`
          };
        }
      }
    },
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_ROUTER: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    }
  });

  const executionContext = {
    requestData: { url: `tenant.test/hello`, requestId: `req-route-01` },
    meta: { requestId: `req-route-01`, correlationId: `req-route-01` }
  };

  const firstRoute = await resolver.resolveRoute(executionContext);
  const secondRoute = await resolver.resolveRoute(executionContext);
  await flushAsyncOperations();

  assert.equal(firstRoute.host, `tenant.test`);
  assert.equal(secondRoute.host, `tenant.test`);
  assert.equal(rpcCalls, 1);
  assert.deepEqual(rpcRequests[0].internalMeta, {
    requestId: `req-route-01`,
    correlationId: `req-route-01`
  });
  assert.deepEqual(cacheSets, [
    {
      key: `urlRouteData:tenant.test/hello`,
      value: JSON.stringify({
        host: `tenant.test`,
        rootFolder: `/tmp/tenant`,
        controller: `controllers/hello.js`
      }),
      ttl: 60000
    }
  ]);
});

test(`route resolution writes a negative route-miss cache entry after a confirmed miss`, async () => {
  const cacheSets = [];
  let rpcCalls = 0;
  const resolver = new Network2ManagerResolver({
    config: {
      question: {
        tenancyRouter: `tenancyRouter`
      },
      tenancyRouter: {
        routeMissTTL: 5000
      }
    },
    routeCacheTTL: 60000,
    services: {
      cache: {
        async get() {
          return null;
        },
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      },
      rpc: {
        async ask() {
          rpcCalls += 1;
          return null;
        }
      }
    },
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_ROUTER: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    }
  });

  const executionContext = {
    requestData: { url: `tenant.test/missing` }
  };

  const route = await resolver.resolveRoute(executionContext);
  await flushAsyncOperations();

  assert.equal(route, null);
  assert.equal(rpcCalls, 1);
  assert.deepEqual(cacheSets, [
    {
      key: `urlRouteMiss:tenant.test/missing`,
      value: `1`,
      ttl: 5000
    }
  ]);
});

test(`route resolution short-circuits manager lookup when a negative route-miss cache entry exists`, async () => {
  let rpcCalls = 0;
  let cacheReads = 0;
  const resolver = new Network2ManagerResolver({
    config: {
      question: {
        tenancyRouter: `tenancyRouter`
      },
      tenancyRouter: {
        routeMissTTL: 5000
      }
    },
    routeCacheTTL: 60000,
    services: {
      cache: {
        async get(key) {
          cacheReads += 1;
          if (key === `urlRouteMiss:tenant.test/missing`) return `1`;
          return null;
        },
        async set() {
          throw new Error(`negative hit should not write cache`);
        }
      },
      rpc: {
        async ask() {
          rpcCalls += 1;
          return {
            host: `tenant.test`,
            rootFolder: `/tmp/tenant`,
            controller: `controllers/hello.js`
          };
        }
      }
    },
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_ROUTER: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    }
  });

  const executionContext = {
    requestData: { url: `tenant.test/missing` }
  };

  const route = await resolver.resolveRoute(executionContext);

  assert.equal(route, null);
  assert.equal(cacheReads, 1);
  assert.equal(rpcCalls, 0);
});

test(`route resolution bypasses route and miss caches while tenancy scan is active`, async () => {
  const cacheSets = [];
  const cacheReads = [];
  let rpcCalls = 0;
  const resolver = new Network2ManagerResolver({
    config: {
      question: {
        tenancyRouter: `tenancyRouter`
      },
      tenancyRouter: {
        routeMissTTL: 5000,
        scanActiveCacheKey: `tenancyScanActive`
      }
    },
    routeCacheTTL: 60000,
    services: {
      cache: {
        async get(key) {
          cacheReads.push(key);
          if (key === `tenancyScanActive`) return `1`;
          if (key.startsWith(`urlRouteData:`) || key.startsWith(`urlRouteMiss:`)) {
            throw new Error(`route cache should be bypassed while scan is active`);
          }
          return null;
        },
        async set(key, value, ttl) {
          cacheSets.push({ key, value, ttl });
        }
      },
      rpc: {
        async ask() {
          rpcCalls += 1;
          return {
            host: `tenant.test`,
            rootFolder: `/tmp/tenant`,
            controller: `controllers/hello.js`
          };
        }
      }
    },
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_ROUTER: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    }
  });

  const route = await resolver.resolveRoute({
    requestData: { url: `tenant.test/hello` }
  });
  await flushAsyncOperations();

  assert.equal(route?.host, `tenant.test`);
  assert.equal(rpcCalls, 1);
  assert.deepEqual(cacheReads, [`tenancyScanActive`]);
  assert.deepEqual(cacheSets, []);
});

test(`route resolution throws immediately when manager returns an explicit RPC failure`, async () => {
  let cacheSetCalled = false;
  const resolver = new Network2ManagerResolver({
    config: {
      question: {
        tenancyRouter: `tenancyRouter`
      },
      tenancyRouter: {
        routeMissTTL: 5000
      }
    },
    routeCacheTTL: 60000,
    services: {
      cache: {
        async get() {
          return null;
        },
        async set() {
          cacheSetCalled = true;
        }
      },
      rpc: {
        async ask() {
          return {
            success: false,
            error: `RPC listener not ready for question "tenancyRouter"`
          };
        }
      }
    },
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_ROUTER: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    }
  });

  await assert.rejects(
    () => resolver.resolveRoute({
      requestData: { url: `tenant.test/hello` }
    }),
    /RPC listener not ready/
  );

  assert.equal(cacheSetCalled, false);
});

test(`tenant route falls back to GET when methods and methodsAvailable are omitted`, () => {
  const tenantRoute = new TenantRoute({
    host: `tenant.test`,
    domain: `tenant.test`,
    subdomain: `www`,
    rootFolder: `/tmp/tenant`,
    controller: `controllers/hello.js`
  });

  assert.deepEqual(tenantRoute.methodsAvailable, [`GET`]);
  assert.deepEqual(tenantRoute.methods, [`GET`]);
  assert.equal(tenantRoute.allowsHostMethod(`GET`), true);
  assert.equal(tenantRoute.allowsHostMethod(`POST`), false);
  assert.equal(tenantRoute.allowsMethod(`GET`), true);
  assert.equal(tenantRoute.allowsMethod(`POST`), false);
});

test(`tenant route resolves static assets from the src public tree`, () => {
  const tenantRoute = new TenantRoute({
    host: `tenant.test`,
    domain: `tenant.test`,
    subdomain: `www`,
    rootFolder: `/tmp/tenant`,
    publicRootFolder: `/tmp/tenant/src/public`,
    asset: `htm/index.htm`
  });

  assert.equal(tenantRoute.assetPath(), `/tmp/tenant/src/public/htm/index.htm`);
});

test(`local file stream stage lets a queued consumer retry and reuse the cached artifact`, async () => {
  const calls = [];
  let cacheReads = 0;
  let body = null;
  const meta = new ExecutionMetaData();
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      cache: `60000`,
      isStaticAsset() {
        return false;
      }
    },
    requestData: {
      url: `tenant.test/hello`
    },
    services: {
      cache: {
        async get() {
          cacheReads += 1;
          return cacheReads === 1 ? null : `/tmp/cached-response.txt`;
        }
      },
      storage: {
        async fileExists(filePath) {
          return filePath === `/tmp/cached-response.txt`;
        },
        async readStream(filePath) {
          return { filePath };
        }
      }
    },
    meta,
    async askManager(question, payload) {
      calls.push({ question, payload });
      if (question === `queue` && payload.queueLabel === `validResponseCache:tenant.test/hello`) {
        return { taskId: 7, first: false };
      }
      if (question === `queue` && payload.queueLabel === `staticQueue:undefined`) {
        throw new Error(`unexpected static queue label`);
      }
      if (question === `queue` && payload.queueLabel === `staticQueue:tenant.test`) {
        return { success: true, taskId: 8, first: true };
      }
      if (question === `dequeue`) return { success: true };
      return null;
    },
    addFinishCallback() {},
    setHeader() {},
    setBody(value) {
      body = value;
    },
    setStatus() {}
  };

  const continuePipeline = await localFileStreamStage(stageContext);

  assert.equal(continuePipeline, false);
  assert.deepEqual(body, { filePath: `/tmp/cached-response.txt` });
  assert.equal(meta.cached, true);
  assert.deepEqual(calls.map((call) => call.question), [`queue`, `dequeue`, `queue`]);
});

test(`local file stream stage clears a stale response-cache pointer when the artifact is missing`, async () => {
  const deletedKeys = [];
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      cache: `60000`,
      isStaticAsset() {
        return false;
      }
    },
    requestData: {
      url: `tenant.test/stale`
    },
    services: {
      cache: {
        async get() {
          return `/tmp/missing-cache-artifact.txt`;
        },
        async delete(key) {
          deletedKeys.push(key);
          return true;
        }
      },
      storage: {
        async fileExists() {
          return false;
        }
      }
    },
    async askManager() {
      return { success: true, taskId: 1 };
    },
    addFinishCallback() {},
    setHeader() {},
    setBody() {},
    setStatus() {}
  };

  const continuePipeline = await localFileStreamStage(stageContext);

  assert.equal(continuePipeline, true);
  assert.deepEqual(deletedKeys, [`validResponseCache:tenant.test/stale`]);
});

test(`local file stream stage returns 304 when If-Modified-Since matches cached artifact mtime`, async () => {
  let readStreamCalled = false;
  const responseData = {
    status: 200,
    headers: {},
    body: `initial`
  };
  const artifactMtimeMs = Date.UTC(2026, 2, 23, 16, 0, 0);
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      cache: `60000`,
      isStaticAsset() {
        return false;
      }
    },
    requestData: {
      url: `tenant.test/hello`,
      headers: {
        'if-modified-since': new Date(artifactMtimeMs + 5000).toUTCString()
      }
    },
    services: {
      cache: {
        async get() {
          return `/tmp/cached-response.txt`;
        }
      },
      storage: {
        async fileExists(filePath) {
          return filePath === `/tmp/cached-response.txt`;
        },
        async fileStat(filePath) {
          if (filePath !== `/tmp/cached-response.txt`) {
            throw new Error(`unexpected stat path`);
          }
          return { mtimeMs: artifactMtimeMs };
        },
        async readStream() {
          readStreamCalled = true;
          return { filePath: `/tmp/cached-response.txt` };
        }
      }
    },
    meta: new ExecutionMetaData(),
    async askManager(question, payload) {
      if (question !== `queue`) return null;
      assert.equal(payload.queueLabel, `staticQueue:tenant.test`);
      return { success: true, taskId: 3 };
    },
    addFinishCallback() {},
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setBody(value) {
      responseData.body = value;
    },
    setStatus(value) {
      responseData.status = value;
    }
  };

  const continuePipeline = await localFileStreamStage(stageContext);

  assert.equal(continuePipeline, false);
  assert.equal(responseData.status, 304);
  assert.equal(responseData.body, null);
  assert.equal(readStreamCalled, false);
  assert.equal(responseData.headers[`Last-Modified`], new Date(artifactMtimeMs).toUTCString());
  assert.equal(stageContext.meta.cached, true);
});

test(`local file stream stage sets Last-Modified when streaming cached artifacts`, async () => {
  const responseData = {
    status: 200,
    headers: {},
    body: null
  };
  const artifactMtimeMs = Date.UTC(2026, 2, 23, 16, 1, 0);
  const streamBody = { filePath: `/tmp/cached-response.txt` };
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      cache: `60000`,
      isStaticAsset() {
        return false;
      }
    },
    requestData: {
      url: `tenant.test/hello`,
      headers: {}
    },
    services: {
      cache: {
        async get() {
          return `/tmp/cached-response.txt`;
        }
      },
      storage: {
        async fileExists(filePath) {
          return filePath === `/tmp/cached-response.txt`;
        },
        async fileStat() {
          return { mtimeMs: artifactMtimeMs };
        },
        async readStream() {
          return streamBody;
        }
      }
    },
    meta: new ExecutionMetaData(),
    async askManager(question, payload) {
      if (question !== `queue`) return null;
      assert.equal(payload.queueLabel, `staticQueue:tenant.test`);
      return { success: true, taskId: 4 };
    },
    addFinishCallback() {},
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setBody(value) {
      responseData.body = value;
    },
    setStatus(value) {
      responseData.status = value;
    }
  };

  const continuePipeline = await localFileStreamStage(stageContext);

  assert.equal(continuePipeline, false);
  assert.equal(responseData.status, 200);
  assert.deepEqual(responseData.body, streamBody);
  assert.equal(responseData.headers[`Last-Modified`], new Date(artifactMtimeMs).toUTCString());
  assert.equal(stageContext.meta.cached, true);
});

test(`shared cache file-storage adapter honors millisecond ttl and deleteByPrefix invalidation`, async () => {
  const prefix = `shared-cache-test:${Date.now()}:`;
  const cacheService = new SharedCacheService(createSharedCacheKernelContext());

  await cacheService.set(`${prefix}ttl`, `value`, 20);
  assert.equal(await cacheService.get(`${prefix}ttl`, null), `value`);

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(await cacheService.get(`${prefix}ttl`, null), null);

  await cacheService.set(`${prefix}a`, `A`);
  await cacheService.set(`${prefix}b`, `B`);
  const removed = await cacheService.deleteByPrefix(prefix);

  assert.equal(removed, 2);
  assert.equal(await cacheService.has(`${prefix}a`), false);
  assert.equal(await cacheService.has(`${prefix}b`), false);
});

test(`tenancy router invalidates shared route and response cache prefixes after a successful scan`, async () => {
  const deletions = [];
  const tenancyRouter = new TenancyRouter({
    config: {
      _adapters: {
        tenancyRouter: require.resolve(`@/adapters/manager/tenancy-router/default-tenancy`)
      },
      tenancyRouter: {
        tenantsPath: `/tmp/tenancy-router-test`,
        routeMatchTTL: 60000,
        scanIntervalMs: 300000
      }
    },
    plugin: {
      async run() {}
    },
    gateways: {
      storageService: createTenancyRouterStorageMock(),
      sharedCacheService: {
        async deleteByPrefix(prefix) {
          deletions.push(prefix);
          return 1;
        }
      }
    }
  });
  tenancyRouter.localCache.set(`tenant.test/hello`, {
    tenantRoute: { host: `tenant.test` },
    validUntil: Date.now() + 1000
  });

  await tenancyRouter.runScanCycle();

  assert.equal(tenancyRouter.localCache.size, 0);
  assert.deepEqual(deletions, [
    `urlRouteData:`,
    `urlRouteMiss:`,
    `validResponseCache:`
  ]);
});

test(`tenancy router asynchronously removes orphaned response-cache artifacts from tenant cache folders`, async () => {
  const deletedPaths = [];
  const storageService = createTenancyRouterResponseCacheStorageMock({
    deletedPaths
  });
  const sharedCacheService = {
    async get(key) {
      if (key === `validResponseCache:www.example.com/hello`) {
        return `/tmp/tenancy-router-cleanup/example.com/www/cache/[www.example.com]_[hello].txt`;
      }
      return null;
    },
    async deleteByPrefix() {
      return 0;
    }
  };
  const tenancyRouter = new TenancyRouter({
    config: {
      _adapters: {
        tenancyRouter: require.resolve(`@/adapters/manager/tenancy-router/default-tenancy`)
      },
      tenancyRouter: {
        tenantsPath: `/tmp/tenancy-router-cleanup`,
        routeMatchTTL: 60000,
        scanIntervalMs: 300000,
        responseCacheCleanupIntervalMs: 300000
      }
    },
    plugin: {
      async run() {}
    },
    gateways: {
      storageService,
      sharedCacheService
    }
  });

  const removed = await tenancyRouter.cleanupInvalidResponseCacheArtifacts();

  assert.equal(removed, 1);
  assert.deepEqual(deletedPaths, [
    `/tmp/tenancy-router-cleanup/example.com/www/cache/[www.example.com]_[stale].txt`
  ]);
});

test(`default tenancy scan ignores disabled hosts and disabled aliases during route resolution`, async () => {
  await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-enable-rules`
    },
    storage: createTenancyRouterEnableRulesStorageMock()
  });

  const directHostRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `www.example.com/hello`
  });
  const fallbackHostRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `example.com/hello`
  });
  const disabledHostRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `api.example.com/hello`
  });
  const enabledAliasRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `enabled.alias.test/hello`
  });
  const disabledAliasRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `disabled.alias.test/hello`
  });
  const aliasToDisabledHostRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `blocked.alias.test/hello`
  });

  assert.equal(directHostRoute?.host, `www.example.com`);
  assert.equal(directHostRoute?.controller, `controllers/hello.js`);
  assert.equal(fallbackHostRoute?.host, `www.example.com`);
  assert.equal(disabledHostRoute, null);
  assert.equal(enabledAliasRoute?.host, `www.example.com`);
  assert.equal(disabledAliasRoute, null);
  assert.equal(aliasToDisabledHostRoute, null);
});

test(`default tenancy scan skips malformed host config and writes validation error file inside host src`, async () => {
  const writes = [];
  const deletes = [];
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-invalid-config`
    },
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-router-invalid-config`) {
          return [createDirentMock(`example.com`, { directory: true })];
        }
        if (targetPath === `/tmp/tenancy-router-invalid-config/example.com`) {
          return [
            createDirentMock(`www`, { directory: true }),
            createDirentMock(`api`, { directory: true })
          ];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-router-invalid-config/example.com/www/src/config.json`) {
          return JSON.stringify({
            routesAvailable: {
              '/ok': {
                controller: `controllers/ok.js`
              }
            }
          });
        }
        if (targetPath === `/tmp/tenancy-router-invalid-config/example.com/api/src/config.json`) {
          return `{"routesAvailable":`; // malformed json
        }
        throw new Error(`Unexpected readFile path: ${targetPath}`);
      },
      async writeFile(targetPath, content) {
        writes.push({ targetPath, content });
      },
      async deleteFile(targetPath) {
        deletes.push(targetPath);
        return true;
      }
    }
  });

  const validRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `www.example.com/ok`
  });
  const invalidRoute = await defaultTenancyAdapter.matchRouteAdapter({
    url: `api.example.com/ok`
  });

  assert.equal(validRoute?.host, `www.example.com`);
  assert.equal(invalidRoute, null);
  assert.ok(Array.isArray(summary.invalidHosts));
  assert.equal(summary.invalidHosts.length, 1);
  assert.equal(summary.invalidHosts[0].host, `api.example.com`);
  assert.ok(String(summary.invalidHosts[0].error?.message ?? ``).length > 0);

  const errorWrite = writes.find((entry) => entry.targetPath.endsWith(`/api/src/config.validation.error.json`));
  assert.ok(errorWrite);
  const parsedError = JSON.parse(errorWrite.content);
  assert.equal(parsedError.host, `api.example.com`);
  assert.equal(parsedError.status, `invalid_config`);
  assert.ok(deletes.some((entry) => entry.endsWith(`/www/src/config.validation.error.json`)));
});

test(`default tenancy scan ignores domain config.json entirely`, async () => {
  const writes = [];
  const summary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-ignore-domain-config`
    },
    storage: {
      async listEntries(targetPath) {
        if (targetPath === `/tmp/tenancy-router-ignore-domain-config`) {
          return [createDirentMock(`example.com`, { directory: true })];
        }
        if (targetPath === `/tmp/tenancy-router-ignore-domain-config/example.com`) {
          return [
            createDirentMock(`config.json`, { file: true }),
            createDirentMock(`www`, { directory: true })
          ];
        }
        return [];
      },
      async readFile(targetPath) {
        if (targetPath === `/tmp/tenancy-router-ignore-domain-config/example.com/www/src/config.json`) {
          return JSON.stringify({
            routesAvailable: {
              '/hello': {
                controller: `controllers/hello.js`
              }
            }
          });
        }
        if (targetPath === `/tmp/tenancy-router-ignore-domain-config/example.com/config.json`) {
          return `{"ignored":`;
        }
        throw new Error(`Unexpected readFile path: ${targetPath}`);
      },
      async writeFile(targetPath, content) {
        writes.push({ targetPath, content });
      }
    }
  });

  const route = await defaultTenancyAdapter.matchRouteAdapter({
    url: `www.example.com/hello`
  });

  assert.equal(route?.host, `www.example.com`);
  assert.equal(summary.invalidHosts.length, 0);
  assert.equal(writes.length, 0);
});

test(`default tenancy scan marks hosts as changed when src/app/index.js or src/config.json mtime changes`, async () => {
  const storage = createTenancyRouterChangeFingerprintStorageMock();
  await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-change-fingerprint`
    },
    storage
  });

  storage.setEntrypointMtimeMs(2000);
  const entrypointSummary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-change-fingerprint`
    },
    storage
  });
  assert.ok(entrypointSummary.changedHosts.includes(`www.example.com`));

  storage.setHostConfigMtimeMs(3000);
  const configSummary = await defaultTenancyAdapter.scanTenantsAdapter({
    config: {
      tenantsPath: `/tmp/tenancy-router-change-fingerprint`
    },
    storage
  });
  assert.ok(configSummary.changedHosts.includes(`www.example.com`));
});

test(`tenancy router asks main to reload changed tenants and stop removed tenants after successful rescans`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-tenancy-router-sync-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `let scanCalls = 0;`,
    `module.exports = {`,
    `  async scanTenantsAdapter() {`,
    `    scanCalls += 1;`,
    `    if (scanCalls === 1) return { initialScan: true, changedHosts: [], removedHosts: [] };`,
    `    return {`,
    `      initialScan: false,`,
    `      changedHosts: ['www.example.com'],`,
    `      removedHosts: ['api.example.com']`,
    `    };`,
    `  },`,
    `  async matchRouteAdapter() { return null; },`,
    `  async destroyAdapter() {}`,
    `};`
  ].join(`\n`));

  const asks = [];
  try {
    const tenancyRouter = new TenancyRouter({
      config: {
        _adapters: {
          tenancyRouter: adapterPath
        },
        tenancyRouter: {
          tenantsPath: `/tmp/tenancy-router-sync`,
          routeMatchTTL: 60000,
          scanIntervalMs: 300000
        },
        processSupervisor: {
          question: {
            reloadProcess: `reloadProcess`,
            shutdownProcess: `shutdownProcess`
          }
        }
      },
      plugin: {
        async run() {}
      },
      gateways: {
        storageService: {
          async listEntries() {
            return [];
          }
        },
        sharedCacheService: {
          async deleteByPrefix() {
            return 0;
          }
        },
        rpcEndpoint: {
          async ask(payload) {
            asks.push(payload);
            return { success: true };
          }
        }
      }
    });

    await tenancyRouter.runScanCycle();
    assert.deepEqual(asks, []);

    await tenancyRouter.runScanCycle();

    assert.deepEqual(asks, [
      {
        target: `main`,
        question: `reloadProcess`,
        data: {
          label: `tenant_www.example.com`,
          reason: `tenancy_scan_changed`
        }
      },
      {
        target: `main`,
        question: `shutdownProcess`,
        data: {
          label: `tenant_api.example.com`,
          reason: `tenancy_scan_removed`
        }
      }
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`tenancy router proactively ensures active tenant apps and shuts down stale tenant_* processes after scans`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-tenancy-router-reconcile-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  async scanTenantsAdapter() {`,
    `    return {`,
    `      initialScan: false,`,
    `      changedHosts: [],`,
    `      removedHosts: [],`,
    `      activeHosts: [`,
    `        { host: 'www.example.com', rootFolder: '/tmp/tenants/example.com/www' }`,
    `      ]`,
    `    };`,
    `  },`,
    `  async matchRouteAdapter() { return null; },`,
    `  async destroyAdapter() {}`,
    `};`
  ].join(`\n`));

  const asks = [];
  try {
    const tenancyRouter = new TenancyRouter({
      config: {
        _adapters: {
          tenancyRouter: adapterPath
        },
        tenancyRouter: {
          tenantsPath: `/tmp/tenancy-router-reconcile`,
          routeMatchTTL: 60000,
          scanIntervalMs: 300000,
          spawnTenantAppAfterScan: true
        },
        processSupervisor: {
          question: {
            ensureProcess: `ensureProcess`,
            listProcesses: `listProcesses`,
            shutdownProcess: `shutdownProcess`
          }
        }
      },
      plugin: {
        async run() {}
      },
      gateways: {
        storageService: {
          async listEntries() {
            return [];
          }
        },
        sharedCacheService: {
          async deleteByPrefix() {
            return 0;
          }
        },
        rpcEndpoint: {
          async ask(payload) {
            asks.push(payload);
            if (payload.question === `listProcesses`) {
              return {
                success: true,
                processes: [
                  { label: `tenant_www.example.com`, pid: 101, state: `ready` },
                  { label: `tenant_old.example.com`, pid: 102, state: `ready` },
                  { label: `engine_0`, pid: 201, state: `ready` }
                ]
              };
            }
            return { success: true };
          }
        }
      }
    });

    await tenancyRouter.runScanCycle();

    assert.deepEqual(asks, [
      {
        target: `main`,
        question: `ensureProcess`,
        data: {
          label: `tenant_www.example.com`,
          reason: `tenancy_scan_ensure`,
          processType: `tenantApp`,
          tenantHost: `www.example.com`,
          tenantRoot: `/tmp/tenants/example.com/www`
        }
      },
      {
        target: `main`,
        question: `listProcesses`,
        data: {}
      },
      {
        target: `main`,
        question: `shutdownProcess`,
        data: {
          label: `tenant_old.example.com`,
          reason: `tenancy_scan_inactive_host`
        }
      }
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`tenant app controller cache reloads a controller module when the source file changes`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-controller-reload-`));
  const tenantAppPath = path.join(tempRoot, `src`, `app`);
  const controllerPath = path.join(tenantAppPath, `controllers`, `hello.js`);
  fs.mkdirSync(path.dirname(controllerPath), { recursive: true });
  fs.writeFileSync(
    controllerPath,
    `module.exports = async function hello() { return { status: 200, body: 'first' }; };\n`
  );

  const controllerCache = new Map();

  try {
    const firstResponse = await handleTenantControllerRequest({
      tenantRoute: {
        controller: `controllers/hello.js`
      },
      requestData: { url: `www.example.com/hello` },
      sessionData: {},
      tenantAppPath,
      tenantRoot: tempRoot,
      tenantLabel: `tenant_www.example.com`,
      tenantApp: null,
      services: {},
      controllerCache
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(
      controllerPath,
      `module.exports = async function hello() { return { status: 200, body: 'second' }; };\n`
    );
    const refreshedAt = new Date(Date.now() + 1000);
    fs.utimesSync(controllerPath, refreshedAt, refreshedAt);

    const secondResponse = await handleTenantControllerRequest({
      tenantRoute: {
        controller: `controllers/hello.js`
      },
      requestData: { url: `www.example.com/hello` },
      sessionData: {},
      tenantAppPath,
      tenantRoot: tempRoot,
      tenantLabel: `tenant_www.example.com`,
      tenantApp: null,
      services: {},
      controllerCache
    });

    assert.equal(firstResponse.body, `first`);
    assert.equal(secondResponse.body, `second`);
  } finally {
    if (fs.existsSync(controllerPath)) {
      delete require.cache[require.resolve(controllerPath)];
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`mid queue stage returns 503 with Retry-After when the controller queue is saturated`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {}
  };
  const stageContext = {
    tenantRoute: { host: `tenant.test`, controller: `controllers/hello.js` },
    requestPipelineConfig: {
      queue: {
        controllerMaxConcurrent: 5,
        controllerWaitTimeoutMs: 1000,
        retryAfterMs: 500
      }
    },
    async askManager() {
      return {
        success: false,
        reason: `queue_full`,
        queueLabel: `controllerQueue:tenant.test`,
        maxWaiting: 1000
      };
    },
    addFinishCallback() {
      throw new Error(`finish callback should not be added`);
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setBody(value) {
      responseData.body = value;
    },
    setStatus(value) {
      responseData.status = value;
    }
  };

  const continuePipeline = await require(`@/adapters/engine/request-pipeline/default-pipeline/stages/mid-queue-stage`)(stageContext);

  assert.equal(continuePipeline, false);
  assert.equal(responseData.status, 503);
  assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.ok(responseData.headers[`Retry-After`]);
  assert.match(responseData.body, /^Controller queue is saturated in this non-production environment\./);
});

test(`mid queue stage returns 504 with Retry-After when controller queue wait times out`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {}
  };
  const stageContext = {
    tenantRoute: { host: `tenant.test`, controller: `controllers/hello.js` },
    requestPipelineConfig: {
      queue: {
        controllerMaxConcurrent: 5,
        controllerWaitTimeoutMs: 1000,
        retryAfterMs: 500
      }
    },
    async askManager() {
      return {
        success: false,
        reason: `queue_wait_timeout`,
        queueLabel: `controllerQueue:tenant.test`
      };
    },
    addFinishCallback() {
      throw new Error(`finish callback should not be added`);
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setBody(value) {
      responseData.body = value;
    },
    setStatus(value) {
      responseData.status = value;
    }
  };

  const continuePipeline = await require(`@/adapters/engine/request-pipeline/default-pipeline/stages/mid-queue-stage`)(stageContext);

  assert.equal(continuePipeline, false);
  assert.equal(responseData.status, 504);
  assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.ok(responseData.headers[`Retry-After`]);
  assert.match(responseData.body, /^Request waited too long in the controller queue for this non-production environment\./);
});

test(`mid session queue stage serializes same-session requests and registers dequeue release`, async () => {
  const asks = [];
  const finishCallbacks = [];
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      session: true
    },
    requestData: {
      cookie: {
        session: `session-123`
      }
    },
    requestPipelineConfig: {
      queue: {
        perSessionMaxConcurrent: 1,
        sessionWaitTimeoutMs: 1000,
        retryAfterMs: 500
      }
    },
    async askManager(question, payload) {
      asks.push({ question, payload });
      if (question === `queue`) {
        return {
          success: true,
          queueLabel: payload.queueLabel,
          taskId: 9,
          first: true
        };
      }
      if (question === `dequeue`) {
        return { success: true };
      }
      return null;
    },
    addFinishCallback(callback) {
      finishCallbacks.push(callback);
    },
    setHeader() {},
    setBody() {},
    setStatus() {}
  };

  const continuePipeline = await midSessionQueueStage(stageContext);
  assert.equal(continuePipeline, true);
  assert.equal(finishCallbacks.length, 1);
  assert.deepEqual(asks[0], {
    question: `queue`,
    payload: {
      queueLabel: `sessionQueue:tenant.test:session-123`,
      maxConcurrent: 1,
      waitTimeoutMs: 1000
    }
  });

  await finishCallbacks[0]();
  assert.deepEqual(asks[1], {
    question: `dequeue`,
    payload: {
      success: true,
      queueLabel: `sessionQueue:tenant.test:session-123`,
      taskId: 9,
      first: true
    }
  });
});

test(`mid session queue stage returns 504 with Retry-After when session queue wait times out`, async () => {
  const responseData = {
    status: 200,
    body: null,
    headers: {}
  };
  const stageContext = {
    tenantRoute: {
      host: `tenant.test`,
      session: true
    },
    requestData: {
      cookie: {
        session: `session-timeout`
      }
    },
    requestPipelineConfig: {
      queue: {
        perSessionMaxConcurrent: 1,
        sessionWaitTimeoutMs: 1000,
        retryAfterMs: 500
      }
    },
    async askManager() {
      return {
        success: false,
        reason: `queue_wait_timeout`,
        queueLabel: `sessionQueue:tenant.test:session-timeout`
      };
    },
    addFinishCallback() {
      throw new Error(`finish callback should not be added`);
    },
    setHeader(key, value) {
      responseData.headers[key] = value;
    },
    setBody(value) {
      responseData.body = value;
    },
    setStatus(value) {
      responseData.status = value;
    }
  };

  const continuePipeline = await midSessionQueueStage(stageContext);
  assert.equal(continuePipeline, false);
  assert.equal(responseData.status, 504);
  assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.ok(responseData.headers[`Retry-After`]);
  assert.match(responseData.body, /^Request waited too long in the session queue for this non-production environment\./);
});

test(`local file stream stage returns a diagnostic static-asset miss message in non-production`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = `development`;

  try {
    const responseData = {
      status: 200,
      body: null,
      headers: {}
    };
    const stageContext = {
      tenantRoute: {
        host: `tenant.test`,
        cache: `no-cache`,
        isStaticAsset() {
          return true;
        },
        assetPath() {
          return `/tmp/tenant/src/public/missing.css`;
        }
      },
      requestData: {
        url: `tenant.test/missing.css`
      },
      services: {
        storage: {
          async fileExists() {
            return false;
          }
        },
        cache: {}
      },
      async askManager(question, payload) {
        if (question !== `queue`) return null;
        assert.equal(payload.queueLabel, `staticQueue:tenant.test`);
        return { success: true, taskId: 10 };
      },
      addFinishCallback() {},
      setHeader(key, value) {
        responseData.headers[key] = value;
      },
      setBody(value) {
        responseData.body = value;
      },
      setStatus(value) {
        responseData.status = value;
      }
    };

    const continuePipeline = await localFileStreamStage(stageContext);

    assert.equal(continuePipeline, false);
    assert.equal(responseData.status, 404);
    assert.equal(responseData.headers[`Content-Type`], `text/plain; charset=utf-8`);
    assert.equal(
      responseData.body,
      `Static asset route resolved, but the target file was not found in this non-production environment.\nAsset path: /tmp/tenant/src/public/missing.css`
    );
  } finally {
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`uWS handler does not double-emit wrapper hooks when manager helpers already own them`, async () => {
  const counts = new Map();
  const eventOrder = [];
  const res = createMockUwsResponse();
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `GET`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const executionContext = {
    req,
    res,
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: `ok` },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        GET_ROUTER: { BEFORE: `get-router.before`, AFTER: `get-router.after`, ERROR: `get-router.error` },
        GET_SESSION: { BEFORE: `get-session.before`, AFTER: `get-session.after`, ERROR: `get-session.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        UPDATE_SESSION: { BEFORE: `update-session.before`, AFTER: `update-session.after`, ERROR: `update-session.error` },
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    async run(hookId) {
      eventOrder.push(hookId);
      counts.set(hookId, (counts.get(hookId) ?? 0) + 1);
    },
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      this.responseData.body = `ok`;
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      await executionContext.run(`get-router.before`);
      executionContext.tenantRoute = {
        methodsAvailable: [`GET`],
        methods: [`GET`],
        contentTypes: null,
        session: false,
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType() {
          return true;
        },
        isRedirect() {
          return false;
        }
      };
      await executionContext.run(`get-router.after`);
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      await executionContext.run(`get-session.before`);
      await executionContext.run(`get-session.after`);
      return {};
    },
    async updateSessionData() {
      await executionContext.run(`update-session.before`);
      await executionContext.run(`update-session.after`);
      return true;
    },
    async setCookiesSession() {}
  };

  await handleHttp(executionContext);

  assert.equal(counts.get(`get-router.before`), 1);
  assert.equal(counts.get(`get-router.after`), 1);
  assert.equal(counts.get(`get-session.before`), 1);
  assert.equal(counts.get(`get-session.after`), 1);
  assert.equal(counts.get(`update-session.before`), 1);
  assert.equal(counts.get(`update-session.after`), 1);
  assert.ok(eventOrder.indexOf(`update-session.after`) < eventOrder.indexOf(`write.start`));
});

test(`uWS handler rejects methods outside the route allowlist with 405 and Allow header`, async () => {
  const res = createMockUwsResponse();
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `POST`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const executionContext = {
    req,
    res,
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: null },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    async run() {},
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      throw new Error(`pipeline should not run`);
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      executionContext.tenantRoute = {
        methodsAvailable: [`GET`, `POST`],
        methods: [`GET`],
        contentTypes: null,
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType() {
          return true;
        },
        isRedirect() {
          return false;
        }
      };
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      throw new Error(`session should not load`);
    },
    async updateSessionData() {
      throw new Error(`session should not update`);
    },
    async setCookiesSession() {}
  };

  await handleHttp(executionContext);

  assert.equal(res.status, `405 Method Not Allowed`);
  assert.equal(res.headers.Allow, `GET`);
  assert.equal(res.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.equal(res.body, `Method Not Allowed`);
});

test(`uWS handler writes a diagnostic body-read validation message in non-production`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = `development`;

  try {
    const res = createMockUwsResponse({
      onData(handler) {
        handler(Buffer.from(`{`), true);
      }
    });
    const req = {
      forEach(callback) {
        callback(`host`, `tenant.test`);
        callback(`content-type`, `application/json`);
        callback(`content-length`, `1`);
      },
      getQuery() {
        return ``;
      },
      getMethod() {
        return `POST`;
      },
      getUrl() {
        return `/hello`;
      }
    };
    const executionContext = {
      req,
      res,
      requestData: null,
      tenantRoute: null,
      responseData: { status: 200, headers: {}, body: null },
      hooks: {
        REQUEST: {
          GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
          BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
          BREAK: `request.break`,
          ERROR: `request.error`
        },
        RESPONSE: {
          WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
        }
      },
      networkEngine: {
        requestPipeline: {
          config: {},
          maxInputBytes: `1MB`
        }
      },
      async run() {},
      async setupRequestData(data) {
        this.requestData = data;
      },
      async runHttpPipeline() {
        throw new Error(`pipeline should not run`);
      },
      async end() {},
      isAborted() {
        return false;
      },
      abort() {}
    };
    executionContext.managerHelper = {
      async resolveRoute() {
        executionContext.tenantRoute = {
          methodsAvailable: [`POST`],
          methods: [`POST`],
          contentTypes: [`application/json`],
          maxInputBytes: `1MB`,
          session: false,
          allowsHostMethod(method) {
            return this.methodsAvailable.includes(method);
          },
          allowsMethod(method) {
            return this.methods.includes(method);
          },
          allowsContentType(contentType) {
            return this.contentTypes.includes(String(contentType).split(`;`)[0].trim().toLowerCase());
          },
          isRedirect() {
            return false;
          }
        };
      }
    };
    executionContext.sessionHelper = {
      async getSessionData() {
        throw new Error(`session should not load`);
      },
      async updateSessionData() {
        throw new Error(`session should not update`);
      },
      async setCookiesSession() {},
      async authSessionCSRF() {
        return { success: true };
      }
    };

    await handleHttp(executionContext);

    assert.equal(res.status, `400 Bad Request`);
    assert.equal(res.headers[`Content-Type`], `text/plain; charset=utf-8`);
    assert.match(res.body, /^Request body validation failed in this non-production environment\.\nReason: invalid JSON body\nDetail: /);
  } finally {
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`session resolver marks metadata for session-enabled routes`, async () => {
  let cookieCalls = 0;
  const resolver = new Network2SessionResolver({
    plugin: {
      hooks: {
        ENGINE: {
          REQUEST: {
            GET_SESSION: { BEFORE: 1, AFTER: 2, ERROR: 3 }
          }
        }
      },
      async run() {}
    },
    sessionRouter: {
      async cookiesResponse({ cookie }) {
        cookieCalls += 1;
        cookie.session = `session-123`;
        cookie.csrfToken = `csrf-123`;
        return {
          session: { value: `session-123` },
          csrfToken: { value: `csrf-123` }
        };
      },
      async getSessionData() {
        return { userId: 7 };
      }
    }
  });
  const executionContext = {
    tenantRoute: { session: true },
    requestData: { cookie: {} },
    responseData: { cookie: null },
    sessionData: null,
    meta: new ExecutionMetaData()
  };

  const sessionData = await resolver.getSessionData(executionContext);

  assert.equal(executionContext.meta.session, true);
  assert.equal(cookieCalls, 1);
  assert.equal(executionContext.requestData.cookie.session, `session-123`);
  assert.equal(executionContext.requestData.cookie.csrfToken, `csrf-123`);
  assert.equal(executionContext.responseData.cookie.session.value, `session-123`);
  assert.deepEqual(sessionData, { userId: 7 });
  assert.deepEqual(executionContext.sessionData, { userId: 7 });
});

test(`request latency classifier applies profile-specific thresholds`, () => {
  const classification = classifyRequestLatency({
    durationMs: 180,
    tenantRoute: {
      isStaticAsset() {
        return false;
      }
    },
    meta: {
      controller: true,
      session: true,
      cached: false
    },
    config: {
      enabled: true,
      profiles: {
        sessionController: { fastMs: 120, okMs: 250, slowMs: 700 },
        default: { fastMs: 100, okMs: 300, slowMs: 900 }
      }
    }
  });

  assert.deepEqual(classification, {
    profile: `sessionController`,
    class: `ok`,
    durationMs: 180,
    thresholds: {
      fastMs: 120,
      okMs: 250,
      slowMs: 700
    }
  });
});

test(`execution context finalization stores latency profile and class in meta`, async () => {
  const meta = new ExecutionMetaData();
  meta.startedAt = Date.now() - 220;
  meta.cached = true;

  const fakeExecutionContext = {
    finishCallbacks: [],
    metaFinalized: false,
    meta,
    tenantRoute: {
      isStaticAsset() {
        return false;
      }
    },
    networkEngine: {
      requestPipeline: {
        config: {
          latencyClassification: {
            enabled: true,
            profiles: {
              cacheHit: { fastMs: 40, okMs: 140, slowMs: 500 },
              default: { fastMs: 120, okMs: 350, slowMs: 900 }
            }
          }
        }
      }
    }
  };

  ExecutionContext.prototype.finalizeMeta.call(fakeExecutionContext);

  assert.equal(Number.isFinite(meta.duration), true);
  assert.equal(meta.latencyProfile, `cacheHit`);
  assert.equal(meta.latencyClass, `slow`);
  assert.deepEqual(meta.latencyThresholds, {
    fastMs: 40,
    okMs: 140,
    slowMs: 500
  });
});

test(`execution context finish callbacks do not freeze meta before response writing`, async () => {
  const meta = new ExecutionMetaData();
  let callbackRan = false;
  const fakeExecutionContext = {
    finishCallbacks: [
      async () => {
        callbackRan = true;
      }
    ],
    meta
  };

  await ExecutionContext.prototype.callFinishCallbacks.call(fakeExecutionContext);
  meta.responseWriteMs = 17;

  assert.equal(callbackRan, true);
  assert.equal(meta.responseWriteMs, 17);
  assert.equal(Object.isFrozen(meta), false);
});

test(`uWS handler records body-read and response-write metadata for successful JSON requests`, async () => {
  const res = createMockUwsResponse({
    onData(handler) {
      handler(Buffer.from(`{"name":"ehecatl"}`), true);
    }
  });
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
      callback(`x-request-id`, `req-incoming-01`);
      callback(`content-type`, `application/json`);
      callback(`content-length`, `18`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `POST`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const meta = new ExecutionMetaData();
  const executionContext = {
    req,
    res,
    meta,
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: null },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    networkEngine: {
      requestPipeline: {
        config: {},
        maxInputBytes: `1MB`
      }
    },
    async run() {},
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      this.responseData.body = { ok: true };
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      executionContext.tenantRoute = {
        methodsAvailable: [`POST`],
        methods: [`POST`],
        contentTypes: [`application/json`],
        session: false,
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType(contentType) {
          return this.contentTypes.includes(String(contentType).split(`;`)[0].trim().toLowerCase());
        },
        isRedirect() {
          return false;
        }
      };
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      return {};
    },
    async updateSessionData() {
      return true;
    },
    async setCookiesSession() {},
    async authSessionCSRF() {
      return { success: true };
    }
  };

  await handleHttp(executionContext);

  assert.equal(Number.isFinite(meta.bodyReadMs), true);
  assert.equal(Number.isFinite(meta.responseWriteMs), true);
  assert.equal(meta.requestId, `req-incoming-01`);
  assert.equal(meta.correlationId, `req-incoming-01`);
  assert.equal(meta.controller, false);
  assert.equal(meta.cached, false);
  assert.equal(executionContext.requestData.requestId, `req-incoming-01`);
  assert.deepEqual(executionContext.requestData.body, { name: `ehecatl` });
  assert.equal(res.headers[`X-Request-Id`], `req-incoming-01`);
  assert.equal(res.status, `200 OK`);
});

test(`uWS handler primes request body capture before async route resolution for POST requests`, async () => {
  let onDataRegisteredBeforeResolve = false;
  let routeResolveStarted = false;
  const res = createMockUwsResponse({
    onData(handler) {
      onDataRegisteredBeforeResolve = !routeResolveStarted;
      setImmediate(() => handler(Buffer.from(`{"name":"ehecatl"}`), true));
    }
  });
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
      callback(`content-type`, `application/json`);
      callback(`content-length`, `18`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `POST`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const executionContext = {
    req,
    res,
    meta: new ExecutionMetaData(),
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: null },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        GET_ROUTER: { BEFORE: `get-router.before`, AFTER: `get-router.after`, ERROR: `get-router.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    networkEngine: {
      requestPipeline: {
        config: {},
        maxInputBytes: `1MB`
      }
    },
    async run() {},
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      this.responseData.body = { ok: true };
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      routeResolveStarted = true;
      await new Promise((resolve) => setImmediate(resolve));
      executionContext.tenantRoute = {
        methodsAvailable: [`POST`],
        methods: [`POST`],
        contentTypes: [`application/json`],
        session: false,
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType(contentType) {
          return this.contentTypes.includes(String(contentType).split(`;`)[0].trim().toLowerCase());
        },
        isRedirect() {
          return false;
        }
      };
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      return {};
    },
    async updateSessionData() {
      return true;
    },
    async setCookiesSession() {},
    async authSessionCSRF() {
      return { success: true };
    }
  };

  await handleHttp(executionContext);

  assert.equal(onDataRegisteredBeforeResolve, true);
  assert.deepEqual(executionContext.requestData.body, { name: `ehecatl` });
  assert.equal(res.status, `200 OK`);
});

test(`uWS handler writes a non-production internal-routing message when route resolution fails`, async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousConsoleError = console.error;
  process.env.NODE_ENV = `development`;
  console.error = () => {};

  try {
    const res = createMockUwsResponse();
    const req = {
      forEach(callback) {
        callback(`host`, `tenant.test`);
      },
      getQuery() {
        return ``;
      },
      getMethod() {
        return `GET`;
      },
      getUrl() {
        return `/hello`;
      }
    };
    const executionContext = {
      req,
      res,
      requestData: null,
      tenantRoute: null,
      responseData: { status: 200, headers: {}, body: null },
      hooks: {
        REQUEST: {
          GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
          BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
          BREAK: `request.break`,
          ERROR: `request.error`
        },
        RESPONSE: {
          WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
        }
      },
      async run() {},
      async setupRequestData(data) {
        this.requestData = data;
      },
      async runHttpPipeline() {
        throw new Error(`pipeline should not run`);
      },
      async end() {},
      isAborted() {
        return false;
      },
      abort() {}
    };
    executionContext.managerHelper = {
      async resolveRoute() {
        throw new Error(`route lookup failed`);
      }
    };
    executionContext.sessionHelper = {
      async getSessionData() {},
      async updateSessionData() {},
      async setCookiesSession() {}
    };

    await handleHttp(executionContext);

    assert.equal(res.status, `500 Internal Server Error`);
    assert.equal(res.headers[`Content-Type`], `text/plain; charset=utf-8`);
    assert.equal(
      res.body,
      `Request routing failed in this non-production environment. See runtime logs for details.`
    );
  } finally {
    console.error = previousConsoleError;
    restoreNodeEnv(previousNodeEnv);
  }
});

test(`uWS handler rejects methods outside the host allowlist before route checks`, async () => {
  const res = createMockUwsResponse();
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `PATCH`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const executionContext = {
    req,
    res,
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: null },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    async run() {},
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      throw new Error(`pipeline should not run`);
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      executionContext.tenantRoute = {
        methodsAvailable: [`GET`, `POST`],
        methods: [`GET`, `POST`, `PATCH`],
        contentTypes: null,
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType() {
          return true;
        },
        isRedirect() {
          return false;
        }
      };
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      throw new Error(`session should not load`);
    },
    async updateSessionData() {
      throw new Error(`session should not update`);
    },
    async setCookiesSession() {}
  };

  await handleHttp(executionContext);

  assert.equal(res.status, `405 Method Not Allowed`);
  assert.equal(res.headers.Allow, `GET, POST`);
  assert.equal(res.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.equal(res.body, `Method Not Allowed`);
});

test(`uWS handler rejects disallowed content types before body parsing`, async () => {
  const res = createMockUwsResponse();
  const req = {
    forEach(callback) {
      callback(`host`, `tenant.test`);
      callback(`content-type`, `text/plain; charset=utf-8`);
      callback(`content-length`, `5`);
    },
    getQuery() {
      return ``;
    },
    getMethod() {
      return `POST`;
    },
    getUrl() {
      return `/hello`;
    }
  };
  const executionContext = {
    req,
    res,
    requestData: null,
    tenantRoute: null,
    responseData: { status: 200, headers: {}, body: null },
    hooks: {
      REQUEST: {
        GET_COOKIE: { BEFORE: `get-cookie.before`, AFTER: `get-cookie.after`, ERROR: `get-cookie.error` },
        BODY: { START: `body.start`, END: `body.end`, ERROR: `body.error` },
        BREAK: `request.break`,
        ERROR: `request.error`
      },
      RESPONSE: {
        WRITE: { START: `write.start`, END: `write.end`, BREAK: `write.break`, ERROR: `write.error` }
      }
    },
    async run() {},
    async setupRequestData(data) {
      this.requestData = data;
    },
    async runHttpPipeline() {
      throw new Error(`pipeline should not run`);
    },
    async end() {},
    isAborted() {
      return false;
    },
    abort() {}
  };
  executionContext.managerHelper = {
    async resolveRoute() {
      executionContext.tenantRoute = {
        methodsAvailable: [`POST`],
        methods: [`POST`],
        contentTypes: [`application/json`],
        allowsHostMethod(method) {
          return this.methodsAvailable.includes(method);
        },
        allowsMethod(method) {
          return this.methods.includes(method);
        },
        allowsContentType(contentType) {
          return this.contentTypes.includes(String(contentType).split(`;`)[0].trim().toLowerCase());
        },
        isRedirect() {
          return false;
        }
      };
    }
  };
  executionContext.sessionHelper = {
    async getSessionData() {
      throw new Error(`session should not load`);
    },
    async updateSessionData() {
      throw new Error(`session should not update`);
    },
    async setCookiesSession() {}
  };

  await handleHttp(executionContext);

  assert.equal(res.status, `415 Unsupported Media Type`);
  assert.equal(res.headers[`Content-Type`], `text/plain; charset=utf-8`);
  assert.equal(res.body, `Unsupported Media Type`);
});

test(`queue broker reads the declared MANAGER.QUEUE_BROKER hook branch`, () => {
  const kernelContext = {
    config: {
      _adapters: {
        queueBroker: `@/adapters/manager/queue-broker/event-memory`
      },
      queueBroker: {
        adapter: `event-memory`,
        defaultTTL: 1000
      }
    },
    plugin: {
      hooks: {
        MANAGER: {
          QUEUE_BROKER: { QUEUE: {}, TASK: {}, ERROR: 999 }
        }
      },
      run() {}
    }
  };

  const queueBroker = new QueueBroker(kernelContext);
  assert.equal(queueBroker.hooks, kernelContext.plugin.hooks.MANAGER.QUEUE_BROKER);
});

test(`event-memory queue adapter times out waiting tasks instead of leaving RPC asks hanging`, async () => {
  const firstTask = await new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel: `test-timeout-queue`,
      maxConcurrent: 1,
      waitTimeoutMs: 50,
      maxWaiting: 4
    }, resolve);
  });

  const waitingTaskPromise = new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel: `test-timeout-queue`,
      maxConcurrent: 1,
      waitTimeoutMs: 20,
      maxWaiting: 4
    }, resolve);
  });

  const waitingTask = await waitingTaskPromise;

  assert.equal(firstTask.success, true);
  assert.equal(waitingTask.success, false);
  assert.equal(waitingTask.reason, `queue_wait_timeout`);

  const released = queueBrokerAdapter.removeFromQueueAdapter({
    queueLabel: `test-timeout-queue`,
    taskId: firstTask.taskId
  });

  assert.equal(released, true);
});

test(`event-memory queue adapter rejects immediately when the queue is full`, async () => {
  const queueLabel = `test-full-queue`;
  const firstTask = await new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel,
      maxConcurrent: 1,
      waitTimeoutMs: 50,
      maxWaiting: 1
    }, resolve);
  });

  const secondTask = await new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel,
      maxConcurrent: 1,
      waitTimeoutMs: 50,
      maxWaiting: 1
    }, resolve);
  });

  assert.equal(firstTask.success, true);
  assert.equal(secondTask.success, false);
  assert.equal(secondTask.reason, `queue_full`);

  const released = queueBrokerAdapter.removeFromQueueAdapter({
    queueLabel,
    taskId: firstTask.taskId
  });

  assert.equal(released, true);
});

test(`event-memory queue adapter can remove queued and running tasks by origin`, async () => {
  const queueLabel = `test-origin-cleanup-queue`;
  const firstTask = await new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel,
      origin: `engine_0`,
      maxConcurrent: 1,
      waitTimeoutMs: 1000,
      maxWaiting: 4
    }, resolve);
  });

  await new Promise((resolve) => {
    queueBrokerAdapter.appendToQueueAdapter({
      queueLabel,
      origin: `engine_0`,
      maxConcurrent: 1,
      waitTimeoutMs: 1000,
      maxWaiting: 4
    }, resolve);
    setImmediate(resolve);
  });

  const cleanup = queueBrokerAdapter.removeTasksByOriginAdapter({
    origin: `engine_0`
  });

  assert.equal(firstTask.success, true);
  assert.deepEqual(cleanup, {
    success: true,
    removed: 2,
    origin: `engine_0`
  });
});

test(`rpc endpoint askDetailed returns merged controller metadata and correlation ids`, async () => {
  let endpoint = null;
  const channel = {
    sendMessage(target, payload) {
      if (!payload.answer) {
        payload.internalMeta = {
          ...(payload.internalMeta ?? {}),
          controllerMeta: {
            coldWaitMs: 27
          }
        };
        setImmediate(() => {
          endpoint.onAnswerHandler(MessageSchema.createAnswer({
            payload,
            origin: target,
            data: {
              success: true,
              body: `ok`
            },
            internalMeta: {
              controllerMeta: {
                controllerMs: 11
              }
            }
          }));
        });
      }
      return true;
    },
    rpcStartListening() {},
    getPID() {
      return process.pid;
    }
  };
  const kernelContext = {
    config: {
      _adapters: {
        rpc: null
      },
      rpc: {
        askTimeoutMs: 100,
        answerTimeoutMs: 100
      }
    },
    plugin: {
      hooks: {
        SHARED: {
          RPC_ENDPOINT: {
            ASK: { BEFORE: 1, AFTER: 2, ERROR: 3 },
            ANSWER: { BEFORE: 4, AFTER: 5, ERROR: 6 },
            CHANNEL: { RECEIVE: 7, SEND: 8, TIMEOUT: 9, ERROR: 10 }
          }
        }
      },
      async run() {}
    }
  };

  endpoint = new RpcEndpoint(kernelContext, { channel });
  const response = await endpoint.askDetailed({
    target: `tenant_tenant.test`,
    question: `tenantController`,
    data: {
      tenantRoute: {
        controller: `controllers/example.js`
      }
    },
    internalMeta: {
      requestId: `req-123`,
      correlationId: `req-123`
    }
  });

  assert.deepEqual(response.data, {
    success: true,
    body: `ok`
  });
  assert.deepEqual(response.internalMeta, {
    requestId: `req-123`,
    correlationId: `req-123`,
    controllerMeta: {
      coldWaitMs: 27,
      controllerMs: 11
    }
  });
});

test(`rpc endpoint answers immediately when a question arrives before its listener is registered`, async () => {
  let endpoint = null;
  const sentMessages = [];
  const channel = {
    sendMessage(target, payload) {
      sentMessages.push({ target, payload });
      if (!payload.answer) {
        setImmediate(() => endpoint.onQuestionHandler({
          ...payload,
          origin: `manager`
        }));
      } else {
        setImmediate(() => endpoint.onAnswerHandler(payload));
      }
      return true;
    },
    rpcStartListening() {},
    getPID() {
      return `engine_0`;
    }
  };
  const kernelContext = {
    config: {
      _adapters: {
        rpc: null
      },
      rpc: {
        askTimeoutMs: 100,
        answerTimeoutMs: 100
      }
    },
    plugin: {
      hooks: {
        SHARED: {
          RPC_ENDPOINT: {
            ASK: { BEFORE: 1, AFTER: 2, ERROR: 3 },
            ANSWER: { BEFORE: 4, AFTER: 5, ERROR: 6 },
            CHANNEL: { RECEIVE: 7, SEND: 8, TIMEOUT: 9, ERROR: 10 }
          }
        }
      },
      async run() {}
    }
  };

  endpoint = new RpcEndpoint(kernelContext, { channel });
  const answer = await endpoint.ask({
    target: `manager`,
    question: `tenancyRouter`,
    data: { url: `tenant.test/hello` }
  });

  assert.deepEqual(answer, {
    success: false,
    error: `RPC listener not ready for question "tenancyRouter"`
  });
  assert.equal(sentMessages.some((entry) => entry.payload?.answer === true), true);
});

test(`rpc endpoint can route local-main answers back through a fallback router when direct send is unavailable`, async () => {
  let endpoint = null;
  const sentMessages = [];
  const channel = {
    sendMessage(target, payload) {
      sentMessages.push({ target, payload });
      if (!payload.answer) {
        setImmediate(() => endpoint.onQuestionHandler({
          ...payload,
          origin: `manager`
        }));
        return true;
      }
      return undefined;
    },
    rpcStartListening() {},
    getPID() {
      return `main`;
    }
  };
  const kernelContext = {
    config: {
      _adapters: {
        rpc: null
      },
      rpc: {
        askTimeoutMs: 100,
        answerTimeoutMs: 100
      }
    },
    plugin: {
      hooks: {
        SHARED: {
          RPC_ENDPOINT: {
            ASK: { BEFORE: 1, AFTER: 2, ERROR: 3 },
            ANSWER: { BEFORE: 4, AFTER: 5, ERROR: 6 },
            CHANNEL: { RECEIVE: 7, SEND: 8, TIMEOUT: 9, ERROR: 10 }
          }
        }
      },
      async run() {}
    }
  };

  endpoint = new RpcEndpoint(kernelContext, {
    channel,
    routeAnswer(target, payload) {
      assert.equal(target, `manager`);
      setImmediate(() => endpoint.onAnswerHandler(payload));
      return true;
    }
  });
  endpoint.addListener(`ensureProcess`, async () => ({ success: true }));

  const answer = await endpoint.ask({
    target: `main`,
    question: `ensureProcess`,
    data: { label: `tenant_www.example.com` }
  });

  assert.deepEqual(answer, { success: true });
  assert.equal(sentMessages.some((entry) => entry.payload?.answer === true), true);
});

test(`logger-runtime uses supervisor heartbeat for MAIN instead of a dead main-process heartbeat hook`, async () => {
  const registrations = [];
  const executor = {
    hooks: {
      MAIN: {
        PROCESS: {
          SPAWN: 1,
          BOOTSTRAP: 2,
          READY: 3,
          SHUTDOWN: 4,
          DEAD: 5,
          CRASH: 6,
          RESTART: 7,
          ERROR: 8,
          HEARTBEAT: 9
        },
        SUPERVISOR: {
          HEARTBEAT: 10,
          BOOTSTRAP: 11,
          READY: 12,
          SHUTDOWN: 13,
          DEAD: 14,
          CRASH: 15,
          RESTART: 16,
          ERROR: 17,
          LAUNCH: { BEFORE: 18, AFTER: 19, ERROR: 20 },
          EXIT: { BEFORE: 21, AFTER: 22, ERROR: 23 }
        }
      },
      MANAGER: { PROCESS: null },
      ENGINE: { PROCESS: null },
      TENANT: { PROCESS: null }
    },
    on(hookId) {
      registrations.push(hookId);
    }
  };

  await loggerRuntime.register.call(loggerRuntime, executor);

  assert.ok(registrations.includes(10));
  assert.equal(registrations.includes(9), false);
});

test(`bootstrap-manager enables heartbeat reporting before tenancy scan to avoid startup timeout regressions`, () => {
  const bootstrapManagerPath = path.join(__dirname, `..`, `bootstrap`, `bootstrap-manager.js`);
  const source = fs.readFileSync(bootstrapManagerPath, `utf8`);

  const heartbeatIndex = source.indexOf(`heartbeatHealth.setHeartbeatCallback`);
  const listenerIndex = source.indexOf(`rpcEndpoint.addListener(nQ.tenancyRouter, (i) => tenancyRouter.matchRoute(i));`);
  const tenancyScanIndex = source.indexOf(`await tenancyRouter.scan()`);
  const readyNotifyIndex = source.indexOf(`state: \`ready\``);

  assert.notEqual(heartbeatIndex, -1);
  assert.notEqual(listenerIndex, -1);
  assert.notEqual(tenancyScanIndex, -1);
  assert.notEqual(readyNotifyIndex, -1);
  assert.ok(heartbeatIndex < tenancyScanIndex);
  assert.ok(listenerIndex < tenancyScanIndex);
  assert.ok(tenancyScanIndex < readyNotifyIndex);
});

test(`bootstrap-tenant-app preloads heartbeat reporting from the shared utils file before privilege drop`, () => {
  const bootstrapTenantPath = path.join(__dirname, `..`, `bootstrap`, `bootstrap-tenant-app.js`);
  const source = fs.readFileSync(bootstrapTenantPath, `utf8`);
  const heartbeatIndex = source.indexOf(`const heartbeatHealth = require(path.join(__dirname, \`..\`, \`utils\`, \`heartbeat-health.js\`));`);
  const privilegeDropIndex = source.indexOf(`Switching tenant app privileges`);

  assert.notEqual(heartbeatIndex, -1);
  assert.notEqual(privilegeDropIndex, -1);
  assert.ok(heartbeatIndex < privilegeDropIndex);
});

test(`process-firewall lifecycle sets up before launch and clears on cleanup for non-engine processes`, async () => {
  const commandCalls = [];
  const { createFirewallLifecycle } = processFirewallPlugin._internal;
  const lifecycle = createFirewallLifecycle({
    enabled: true,
    applyTo: {
      manager: true,
      tenant: true,
      engine: false,
      otherNonEngine: false
    },
    setupCommand: [`cmd_setup`],
    clearCommand: [`cmd_clear`],
    refreshAfterLaunch: true,
    commandTimeoutMs: 1200,
    failOnSetupError: true
  }, {
    async runCommand(args) {
      commandCalls.push(args);
      return { code: 0, signal: null };
    }
  });

  const launchContext = {
    label: `manager`,
    processOptions: {
      label: `manager`,
      processUser: `e_manager`
    },
    resources: {},
    cleanupTasks: []
  };

  await lifecycle.onLaunchBefore(launchContext);
  assert.deepEqual(commandCalls[0], [`cmd_setup`, `e_manager`, `manager`, `EHECATL_FW_INPUT_E_MANAGER`]);
  assert.equal(launchContext.cleanupTasks.length, 1);

  await lifecycle.onLaunchAfter({
    resources: launchContext.resources
  });
  assert.deepEqual(commandCalls[1], [`cmd_setup`, `e_manager`, `manager`, `EHECATL_FW_INPUT_E_MANAGER`]);

  await launchContext.cleanupTasks[0]();
  assert.deepEqual(commandCalls[2], [`cmd_clear`, `e_manager`, `manager`, `EHECATL_FW_INPUT_E_MANAGER`]);

  await lifecycle.onExitAfter({
    resources: launchContext.resources
  });
  assert.equal(commandCalls.length, 3);
});

test(`process-firewall lifecycle skips engine processes by default`, async () => {
  const commandCalls = [];
  const { createFirewallLifecycle } = processFirewallPlugin._internal;
  const lifecycle = createFirewallLifecycle({
    enabled: true,
    applyTo: {
      manager: true,
      tenant: true,
      engine: false,
      otherNonEngine: false
    },
    setupCommand: [`cmd_setup`],
    clearCommand: [`cmd_clear`],
    refreshAfterLaunch: true
  }, {
    async runCommand(args) {
      commandCalls.push(args);
      return { code: 0, signal: null };
    }
  });

  await lifecycle.onLaunchBefore({
    label: `engine_0`,
    processOptions: {
      label: `engine_0`,
      processUser: `e_engine`
    },
    resources: {},
    cleanupTasks: []
  });

  assert.equal(commandCalls.length, 0);
});

test(`process-firewall default commands resolve to firewall_setup and firewall_release`, () => {
  const { resolveSetupCommand, resolveClearCommand } = processFirewallPlugin._internal;
  assert.deepEqual(resolveSetupCommand({}, `e_manager`, `manager`).slice(0, 2), [`ehecatl`, `firewall_setup`]);
  assert.deepEqual(resolveClearCommand({}, `e_manager`, `manager`).slice(0, 2), [`ehecatl`, `firewall_release`]);
});

test(`process-firewall shortens long tenant chain names to stay within iptables limits`, () => {
  const { resolveSetupCommand, resolveClearCommand } = processFirewallPlugin._internal;
  const processUser = `e_tenant_www.fakedomain.com`;
  const label = `tenant_www.fakedomain.com`;

  const chainName = resolveInboundFirewallChainName(processUser, label);
  const setupCommand = resolveSetupCommand({}, processUser, label);
  const clearCommand = resolveClearCommand({}, processUser, label);

  assert.equal(chainName.length <= MAX_CHAIN_NAME_LENGTH, true);
  assert.equal(chainName.startsWith(SHORT_INPUT_PREFIX), true);
  assert.equal(setupCommand.at(-1), chainName);
  assert.equal(clearCommand.at(-1), chainName);
});

test(`hourly file logger writes runtime and error lines partitioned by date and hour`, () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-hourly-log-`));
  try {
    const logger = createHourlyFileLogger({
      enabled: true,
      baseDir,
      maxFiles: 50,
      cleanupIntervalMs: 100000
    });

    logger.writeRuntime(`runtime line`);
    logger.writeError(`error line`);

    const dateLabel = new Date().toISOString().slice(0, 10);
    const hourLabel = new Date().toISOString().slice(11, 13);
    const runtimeFile = path.join(baseDir, `runtime`, dateLabel, `${hourLabel}.log`);
    const errorFile = path.join(baseDir, `error`, dateLabel, `${hourLabel}.log`);

    assert.equal(fs.existsSync(runtimeFile), true);
    assert.equal(fs.existsSync(errorFile), true);
    assert.match(fs.readFileSync(runtimeFile, `utf8`), /runtime line/);
    assert.match(fs.readFileSync(errorFile, `utf8`), /error line/);
    logger.close();
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test(`hourly file logger enforces maxFiles retention per channel`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-hourly-retention-`));
  try {
    const channelRoot = path.join(baseDir, `runtime`);
    fs.mkdirSync(path.join(channelRoot, `2026-03-23`), { recursive: true });
    const files = [
      path.join(channelRoot, `2026-03-23`, `00.log`),
      path.join(channelRoot, `2026-03-23`, `01.log`),
      path.join(channelRoot, `2026-03-23`, `02.log`),
      path.join(channelRoot, `2026-03-23`, `03.log`)
    ];

    for (let i = 0; i < files.length; i++) {
      fs.writeFileSync(files[i], `log-${i}\n`, `utf8`);
      const mtime = new Date(Date.now() - (files.length - i) * 1000);
      fs.utimesSync(files[i], mtime, mtime);
    }

    const logger = createHourlyFileLogger({
      enabled: true,
      baseDir,
      maxFiles: 2,
      cleanupIntervalMs: 100000
    });
    logger.writeRuntime(`trigger-cleanup`);
    await new Promise((resolve) => setImmediate(resolve));

    const remaining = [];
    for (const filePath of files) {
      if (fs.existsSync(filePath)) remaining.push(path.basename(filePath));
    }
    assert.ok(remaining.length <= 2);
    logger.close();
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test(`tenant report writer aggregates per-tenant request metrics and flushes report.json`, async () => {
  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-tenant-report-`));
  try {
    const writer = createTenantReportWriter({
      enabled: true,
      relativePath: path.join(`src`, `report.json`),
      flushIntervalMs: 100000
    });

    writer.observeRequest({
      tenantRoute: {
        host: `www.example.com`,
        rootFolder: tenantRoot
      },
      responseData: {
        status: 200
      },
      meta: {
        duration: 18,
        latencyProfile: `cacheHit`,
        latencyClass: `fast`
      }
    });

    writer.observeRequest({
      tenantRoute: {
        host: `www.example.com`,
        rootFolder: tenantRoot
      },
      responseData: {
        status: 503
      },
      meta: {
        duration: 240,
        latencyProfile: `controller`,
        latencyClass: `slow`
      }
    });

    await writer.flushAll();
    await writer.close();

    const reportPath = path.join(tenantRoot, `src`, `report.json`);
    const report = JSON.parse(fs.readFileSync(reportPath, `utf8`));

    assert.equal(report.tenantHost, `www.example.com`);
    assert.equal(report.meta.version, 1);
    assert.equal(typeof report.windowStartedAt, `string`);
    assert.equal(typeof report.lastUpdatedAt, `string`);
    assert.equal(report.totals.requests, 2);
    assert.equal(report.totals.byStatusClass[`2xx`], 1);
    assert.equal(report.totals.byStatusClass[`5xx`], 1);
    assert.equal(report.latency.byProfile.cacheHit, 1);
    assert.equal(report.latency.byProfile.controller, 1);
    assert.equal(report.latency.byClass.fast, 1);
    assert.equal(report.latency.byClass.slow, 1);
    assert.equal(report.latency.duration.count, 2);
    assert.equal(report.latency.duration.totalMs, 258);
    assert.equal(report.latency.duration.avgMs, 129);
    assert.equal(report.latency.duration.minMs, 18);
    assert.equal(report.latency.duration.maxMs, 240);
  } finally {
    fs.rmSync(tenantRoot, { recursive: true, force: true });
  }
});

test(`tenant report writer forces report path under src even when relativePath is configured outside src`, async () => {
  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-tenant-report-src-enforced-`));
  try {
    const writer = createTenantReportWriter({
      enabled: true,
      relativePath: `report.json`,
      flushIntervalMs: 100000
    });

    writer.observeRequest({
      tenantRoute: {
        host: `www.example.com`,
        rootFolder: tenantRoot
      },
      responseData: {
        status: 200
      },
      meta: {
        duration: 12,
        latencyProfile: `cacheHit`,
        latencyClass: `fast`
      }
    });

    await writer.flushAll();
    await writer.close();

    const expectedPath = path.join(tenantRoot, `src`, `report.json`);
    const unexpectedPath = path.join(tenantRoot, `report.json`);

    assert.equal(fs.existsSync(expectedPath), true);
    assert.equal(fs.existsSync(unexpectedPath), false);
  } finally {
    fs.rmSync(tenantRoot, { recursive: true, force: true });
  }
});

test(`logger-runtime updates tenant report on ENGINE.REQUEST.END and flushes on shutdown`, async () => {
  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-plugin-tenant-report-`));
  try {
    const listeners = new Map();
    const hookIds = {
      PROCESS: {
        SHUTDOWN: 4,
        DEAD: 5
      },
      REQUEST: {
        END: 30
      }
    };
    const executor = {
      hooks: {
        MAIN: { PROCESS: null },
        MANAGER: { PROCESS: null },
        TENANT: { PROCESS: null },
        ENGINE: {
          PROCESS: {
            SPAWN: 100,
            BOOTSTRAP: 101,
            READY: 102,
            SHUTDOWN: hookIds.PROCESS.SHUTDOWN,
            DEAD: hookIds.PROCESS.DEAD,
            CRASH: 103,
            RESTART: 104,
            ERROR: 105,
            HEARTBEAT: 106
          },
          REQUEST: {
            END: hookIds.REQUEST.END
          }
        }
      },
      on(id, fn) {
        listeners.set(id, fn);
      },
      getPluginConfig() {
        return {
          fileLogging: {
            enabled: false
          },
          tenantReport: {
            enabled: true,
            relativePath: `src/report.json`,
            flushIntervalMs: 100000
          }
        };
      }
    };

    await loggerRuntime.register.call(loggerRuntime, executor);
    listeners.get(hookIds.REQUEST.END)({
      tenantRoute: {
        host: `www.example.com`,
        rootFolder: tenantRoot
      },
      requestData: {
        method: `GET`,
        url: `/hello`
      },
      responseData: {
        status: 200
      },
      meta: {
        duration: 41,
        latencyProfile: `controller`,
        latencyClass: `ok`,
        session: true,
        cached: false,
        controller: true
      }
    });

    await listeners.get(hookIds.PROCESS.SHUTDOWN)({});
    await loggerRuntime.teardown.call(loggerRuntime);

    const reportPath = path.join(tenantRoot, `src`, `report.json`);
    const report = JSON.parse(fs.readFileSync(reportPath, `utf8`));
    assert.equal(report.totals.requests, 1);
    assert.equal(report.latency.byProfile.controller, 1);
    assert.equal(report.latency.byClass.ok, 1);
  } finally {
    await loggerRuntime.teardown.call(loggerRuntime);
    fs.rmSync(tenantRoot, { recursive: true, force: true });
  }
});

function createMockUwsResponse(overrides = {}) {
  return {
    headers: {},
    status: null,
    body: undefined,
    cork(callback) {
      callback();
      return this;
    },
    writeStatus(value) {
      this.status = value;
      return this;
    },
    writeHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    end(value) {
      this.body = value;
      return this;
    },
    onWritable() {
      return this;
    },
    onAborted(handler) {
      this.onAbortedHandler = handler;
      return this;
    },
    ...overrides
  };
}

function createSharedCacheKernelContext() {
  return {
    config: {
      _adapters: {
        sharedCacheService: require.resolve(`@/adapters/shared/shared-cache/file-storage`)
      },
      sharedCacheService: {
        adapter: `file-storage`
      }
    },
    plugin: {
      hooks: {
        SHARED: {
          SHARED_CACHE: {
            BEFORE: 1,
            AFTER: 2,
            ERROR: 3
          }
        }
      },
      async run() {}
    }
  };
}

function createTenancyRouterStorageMock() {
  return {
    async listEntries(targetPath) {
      if (targetPath === `/tmp/tenancy-router-test`) {
        return [createDirentMock(`example.com`, { directory: true })];
      }
      if (targetPath === `/tmp/tenancy-router-test/example.com`) {
        return [createDirentMock(`www`, { directory: true })];
      }
      return [];
    },
    async readFile(targetPath) {
      if (targetPath === `/tmp/tenancy-router-test/example.com/www/src/config.json`) {
        return JSON.stringify({
          routesAvailable: {
            '/hello': {
              controller: `controllers/hello.js`
            }
          }
        });
      }
      throw new Error(`Unexpected readFile path: ${targetPath}`);
    }
  };
}

function createTenancyRouterResponseCacheStorageMock({ deletedPaths }) {
  return {
    async listEntries(targetPath) {
      if (targetPath === `/tmp/tenancy-router-cleanup`) {
        return [createDirentMock(`example.com`, { directory: true })];
      }
      if (targetPath === `/tmp/tenancy-router-cleanup/example.com`) {
        return [createDirentMock(`www`, { directory: true })];
      }
      if (targetPath === `/tmp/tenancy-router-cleanup/example.com/www/cache`) {
        return [
          createDirentMock(`[www.example.com]_[hello].txt`, { file: true }),
          createDirentMock(`[www.example.com]_[stale].txt`, { file: true })
        ];
      }
      return [];
    },
    async fileExists(targetPath) {
      return targetPath === `/tmp/tenancy-router-cleanup/example.com/www/cache`;
    },
    async deleteFile(targetPath) {
      deletedPaths.push(targetPath);
      return true;
    }
  };
}

function createTenancyRouterEnableRulesStorageMock() {
  return {
    async listEntries(targetPath) {
      if (targetPath === `/tmp/tenancy-router-enable-rules`) {
        return [
          createDirentMock(`example.com`, { directory: true }),
          createDirentMock(`alias.test`, { file: true })
        ];
      }
      if (targetPath === `/tmp/tenancy-router-enable-rules/example.com`) {
        return [
          createDirentMock(`www`, { directory: true }),
          createDirentMock(`api`, { directory: true })
        ];
      }
      return [];
    },
    async readFile(targetPath) {
      if (targetPath === `/tmp/tenancy-router-enable-rules/example.com/www/src/config.json`) {
        return JSON.stringify({
          routesAvailable: {
            '/hello': {
              controller: `controllers/hello.js`
            }
          }
        });
      }
      if (targetPath === `/tmp/tenancy-router-enable-rules/example.com/api/src/config.json`) {
        return JSON.stringify({
          hostEnabled: false,
          routesAvailable: {
            '/hello': {
              controller: `controllers/private.js`
            }
          }
        });
      }
      if (targetPath === `/tmp/tenancy-router-enable-rules/alias.test`) {
        return JSON.stringify({
          enabled: {
            tenant: `www.example.com`
          },
          disabled: {
            tenant: `www.example.com`,
            aliasEnabled: false
          },
          blocked: {
            tenant: `api.example.com`
          }
        });
      }
      throw new Error(`Unexpected readFile path: ${targetPath}`);
    }
  };
}

function createTenancyRouterChangeFingerprintStorageMock() {
  const mtimes = {
    hostConfigMtimeMs: 1000,
    entrypointMtimeMs: 1000
  };

  return {
    setHostConfigMtimeMs(nextMtimeMs) {
      mtimes.hostConfigMtimeMs = nextMtimeMs;
    },
    setEntrypointMtimeMs(nextMtimeMs) {
      mtimes.entrypointMtimeMs = nextMtimeMs;
    },
    async listEntries(targetPath) {
      if (targetPath === `/tmp/tenancy-router-change-fingerprint`) {
        return [createDirentMock(`example.com`, { directory: true })];
      }
      if (targetPath === `/tmp/tenancy-router-change-fingerprint/example.com`) {
        return [createDirentMock(`www`, { directory: true })];
      }
      return [];
    },
    async readFile(targetPath) {
      if (targetPath === `/tmp/tenancy-router-change-fingerprint/example.com/www/src/config.json`) {
        return JSON.stringify({
          routesAvailable: {
            '/hello': {
              controller: `controllers/hello.js`
            }
          }
        });
      }
      throw new Error(`Unexpected readFile path: ${targetPath}`);
    },
    async fileStat(targetPath) {
      if (targetPath === `/tmp/tenancy-router-change-fingerprint/example.com/www/src/config.json`) {
        return { mtimeMs: mtimes.hostConfigMtimeMs };
      }
      if (targetPath === `/tmp/tenancy-router-change-fingerprint/example.com/www/src/app/index.js`) {
        return { mtimeMs: mtimes.entrypointMtimeMs };
      }
      throw new Error(`Unexpected fileStat path: ${targetPath}`);
    }
  };
}

function createDirentMock(name, { directory = false, file = false } = {}) {
  return {
    name,
    isDirectory() {
      return directory;
    },
    isFile() {
      return file;
    }
  };
}

async function flushAsyncOperations() {
  await new Promise((resolve) => setImmediate(resolve));
}

function restoreNodeEnv(value) {
  if (value === undefined) {
    delete process.env.NODE_ENV;
    return;
  }

  process.env.NODE_ENV = value;
}
