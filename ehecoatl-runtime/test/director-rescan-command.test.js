'use strict';

require(`../utils/register-module-aliases`);

const fs = require(`node:fs/promises`);
const os = require(`node:os`);
const path = require(`node:path`);
const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const RpcRuntime = require(`../_core/runtimes/rpc-runtime`);
const TenantDirectoryResolver = require(`../_core/resolvers/tenant-directory-resolver`);
const { sendDirectorQuestion, printRescanSummary, formatInvalidHosts } = require(`../cli/lib/director-rpc-cli`);
const { startDirectorCliSocketServer } = require(`../bootstrap/director-cli-socket`);

test(`rpc runtime askLocal dispatches to local listeners and returns detailed metadata`, async () => {
  const endpoint = createRpcRuntime();
  endpoint.addListener(`tenancyRescanNow`, async (payload, resolveAnswer) => {
    resolveAnswer({
      success: true,
      body: `ok:${payload.reason}`
    }, {
      traceId: `trace-1`
    });
    return false;
  });

  const response = await endpoint.askLocal({
    question: `tenancyRescanNow`,
    data: {
      reason: `cli`
    },
    detailed: true
  });

  assert.deepEqual(response, {
    data: {
      success: true,
      body: `ok:cli`
    },
    internalMeta: {
      traceId: `trace-1`
    }
  });
});

test(`tenant directory resolver coalesces multiple forced rescans behind one running scan`, async () => {
  const resolver = createTenantDirectoryResolver();
  const releases = [];
  let runCount = 0;

  resolver.runScanCycle = async () => {
    runCount += 1;
    await new Promise((resolve) => releases.push(resolve));
    return {
      changedHosts: runCount === 1 ? [`one`] : [`two`],
      removedHosts: [],
      invalidHosts: []
    };
  };

  const firstScan = resolver.scan();
  await waitFor(() => resolver.runtime.activeScanPromise !== null);

  const forcedA = resolver.requestForcedScan({ reason: `cli` });
  const forcedB = resolver.requestForcedScan({ reason: `cli` });

  assert.equal(runCount, 1);

  releases.shift()?.();
  await firstScan;
  await waitFor(() => runCount === 2);
  releases.shift()?.();

  const [forcedResultA, forcedResultB] = await Promise.all([forcedA, forcedB]);
  const forcedResult = forcedResultA;
  assert.equal(runCount, 2);
  assert.equal(forcedResult.success, true);
  assert.equal(forcedResult.waitedForActiveScan, true);
  assert.equal(forcedResult.coalesced, true);
  assert.deepEqual(forcedResult.scanSummary.changedHosts, [`two`]);
  assert.deepEqual(forcedResultB, forcedResultA);
});

test(`director CLI socket forwards one request directly to local RPC listeners`, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ehecoatl-director-rpc-`));
  const socketPath = path.join(tempDir, `director.sock`);
  const endpoint = createRpcRuntime();
  endpoint.addListener(`tenancyRescanNow`, async ({ reason }) => ({
    success: true,
    reason
  }));

  const server = await startDirectorCliSocketServer({
    rpcEndpoint: endpoint,
    config: {
      adapters: {
        rpcRuntime: {
          localAskTimeoutMs: 1000
        }
      }
    },
    socketPath
  });

  try {
    const response = await sendDirectorQuestion({
      socketPath,
      question: `tenancyRescanNow`,
      data: {
        reason: `cli_core_rescan_tenants`
      }
    });

    assert.deepEqual(response, {
      success: true,
      data: {
        success: true,
        reason: `cli_core_rescan_tenants`
      }
    });
  } finally {
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test(`rescan summary prints invalid host details after the current summary shape`, () => {
  const output = captureStdout(() => {
    printRescanSummary({
      success: true,
      data: {
        success: true,
        waitedForActiveScan: false,
        coalesced: false,
        durationMs: 12,
        scanSummary: {
          changedHosts: [],
          removedHosts: [],
          invalidHosts: [{
            scope: `app`,
            host: `app_www.example.com`,
            rootFolder: `/tmp/tenant_example.com/app_www`,
            appConfigPath: `/tmp/tenant_example.com/app_www/config`,
            error: {
              code: `VERSION_MISMATCH`,
              message: `App config ehecoatlVersion mismatch: expected 1.0.0, found 0.9.0`
            }
          }]
        }
      }
    }, `/tmp/director.sock`);
  });

  assert.match(output, /Invalid hosts: 1\nInvalid host details:/);
  assert.match(output, /scope=app/);
  assert.match(output, /host=app_www\.example\.com/);
  assert.match(output, /config=\/tmp\/tenant_example\.com\/app_www\/config/);
  assert.match(output, /VERSION_MISMATCH/);
});

test(`invalid host formatter only emits ANSI red for human color mode`, () => {
  const previousForceColor = process.env.FORCE_COLOR;
  const previousNoColor = process.env.NO_COLOR;

  try {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = `1`;
    assert.match(formatInvalidHosts([{ host: `bad.test`, error: { message: `bad` } }]), /^\x1b\[31m/);

    process.env.NO_COLOR = `1`;
    assert.doesNotMatch(formatInvalidHosts([{ host: `bad.test`, error: { message: `bad` } }]), /\x1b\[/);
  } finally {
    restoreEnvValue(`FORCE_COLOR`, previousForceColor);
    restoreEnvValue(`NO_COLOR`, previousNoColor);
  }
});

function createRpcRuntime() {
  return new RpcRuntime({
    config: {
      _adapters: {
        rpcRuntime: {
          bundled: `@adapter/inbound/rpc-runtime/ipc`,
          custom: `@adapter/inbound/rpc-runtime/ipc`
        }
      },
      adapters: {
        rpcRuntime: {
          adapter: `ipc`,
          askTimeoutMs: 100,
          answerTimeoutMs: 100,
          localAskTimeoutMs: 100
        }
      }
    },
    pluginOrchestrator: {
      hooks: {
        SHARED: {
          RPC_ENDPOINT: {
            ASK: { BEFORE: 1, AFTER: 2, ERROR: 3 },
            ANSWER: { BEFORE: 4, AFTER: 5, ERROR: 6 },
            CHANNEL: { RECEIVE: 7, SEND: 8, TIMEOUT: 9, ERROR: 10 }
          }
        }
      },
      async run() { }
    }
  });
}

function captureStdout(callback) {
  const originalWrite = process.stdout.write;
  let output = ``;
  process.stdout.write = (chunk, encoding, done) => {
    output += String(chunk);
    if (typeof encoding === `function`) encoding();
    if (typeof done === `function`) done();
    return true;
  };

  try {
    callback();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

function restoreEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function createTenantDirectoryResolver() {
  return new TenantDirectoryResolver({
    config: {
      _adapters: {
        tenantDirectoryResolver: {
          bundled: `@adapter/inbound/tenant-directory-resolver/default-tenancy`,
          custom: `@adapter/inbound/tenant-directory-resolver/default-tenancy`
        }
      },
      adapters: {
        tenantDirectoryResolver: {
          adapter: `default-tenancy`,
          scanIntervalMs: 50,
          responseCacheCleanupIntervalMs: 0,
          scanActiveTTL: 1000,
          tenantsPath: `/tmp`
        },
        processForkRuntime: {
          question: {
            shutdownProcess: `shutdownProcess`,
            ensureProcess: `ensureProcess`,
            listProcesses: `listProcesses`
          }
        },
        watchdogOrchestrator: {
          question: {
            reloadProcess: `reloadProcess`
          }
        }
      }
    },
    pluginOrchestrator: {
      async run() { }
    },
    useCases: {
      storageService: {},
      sharedCacheService: {}
    }
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if ((Date.now() - startedAt) > timeoutMs) {
      throw new Error(`Timed out waiting for predicate`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
