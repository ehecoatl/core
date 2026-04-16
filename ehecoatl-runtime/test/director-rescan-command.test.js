'use strict';

require(`../utils/register-module-aliases`);

const fs = require(`node:fs/promises`);
const os = require(`node:os`);
const path = require(`node:path`);
const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const RpcRuntime = require(`../_core/runtimes/rpc-runtime`);
const TenantDirectoryResolver = require(`../_core/resolvers/tenant-directory-resolver`);
const { sendDirectorQuestion } = require(`../cli/lib/director-rpc-cli`);
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
