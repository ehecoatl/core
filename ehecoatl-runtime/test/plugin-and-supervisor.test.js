// test/plugin-and-supervisor.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { EventEmitter } = require(`node:events`);

const PluginOrchestrator = require(`@/_core/orchestrators/plugin-orchestrator`);
const PluginRegistryResolver = require(`@/_core/resolvers/plugin-registry-resolver`);
const MultiProcessOrchestrator = require(`@/_core/orchestrators/multi-process-orchestrator`);
const ProcessForkRuntime = require(`@/_core/runtimes/process-fork-runtime`);
const WatchdogOrchestrator = require(`@/_core/orchestrators/watchdog-orchestrator`);
const processFirewallPlugin = require(`@/extensions/plugins/user-firewall/process-firewall`);

test(`plugin registry resolver respects explicit context activation`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-registry-`));
  const pluginPath = path.join(tempDir, `context-only.js`);
  fs.writeFileSync(pluginPath, [
    `'use strict';`,
    `module.exports = {`,
    `  name: 'context-only',`,
    `  contexts: ['ISOLATED_RUNTIME'],`,
    `  async register(executor) { executor.on(executor.hooks.SHARED.STORAGE.BEFORE, () => {}, this.pluginMeta); },`,
    `  get pluginMeta() { return { plugin: this.name, priority: 0 }; }`,
    `};`
  ].join(`\n`));

  const registryResolver = new PluginRegistryResolver({
    bundledPluginsPath: tempDir,
    pluginsConfig: {
      'logger-runtime': { enabled: false },
      'error-reporter': { enabled: false }
    }
  });

  const loaded = await registryResolver.resolveRegistryEntries(`DIRECTOR`);
  assert.equal(loaded.some((entry) => entry.pluginName === `context-only`), false);
});

test(`plugin registry resolver scans appended custom plugin paths in order`, async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-bundled-`));
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-global-`));
  const tenantDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-tenant-`));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-app-`));

  const pluginSource = (name) => [
    `'use strict';`,
    `module.exports = {`,
    `  name: '${name}',`,
    `  async register() {},`,
    `};`
  ].join(`\n`);

  try {
    fs.writeFileSync(path.join(bundledDir, `bundled.js`), pluginSource(`bundled`));
    fs.writeFileSync(path.join(globalDir, `global.js`), pluginSource(`global`));
    fs.writeFileSync(path.join(tenantDir, `tenant.js`), pluginSource(`tenant`));
    fs.writeFileSync(path.join(appDir, `app.js`), pluginSource(`app`));

    const registryResolver = new PluginRegistryResolver({
      bundledPluginsPath: bundledDir,
      customPluginsPaths: [globalDir, tenantDir, appDir],
      pluginsConfig: {
        'logger-runtime': { enabled: false },
        'error-reporter': { enabled: false }
      }
    });

    const loaded = await registryResolver.resolveRegistryEntries(`ISOLATED_RUNTIME`);
    assert.deepEqual(
      loaded.map((entry) => entry.pluginName),
      [`bundled`, `global`, `tenant`, `app`]
    );
  } finally {
    fs.rmSync(bundledDir, { recursive: true, force: true });
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(tenantDir, { recursive: true, force: true });
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test(`plugin registry resolver treats missing appended plugin paths as optional`, async () => {
  const bundledDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-plugin-optional-`));

  try {
    fs.writeFileSync(path.join(bundledDir, `bundled.js`), [
      `'use strict';`,
      `module.exports = {`,
      `  name: 'bundled',`,
      `  async register() {},`,
      `};`
    ].join(`\n`));

    const registryResolver = new PluginRegistryResolver({
      bundledPluginsPath: bundledDir,
      customPluginsPaths: [
        path.join(bundledDir, `missing-global`),
        path.join(bundledDir, `missing-tenant`)
      ],
      pluginsConfig: {}
    });

    const loaded = await registryResolver.resolveRegistryEntries(`TRANSPORT`);
    assert.deepEqual(
      loaded.map((entry) => entry.pluginName),
      [`bundled`]
    );
  } finally {
    fs.rmSync(bundledDir, { recursive: true, force: true });
  }
});

test(`plugin orchestrator teardown runs before unload removes listeners`, async () => {
  const executor = new PluginOrchestrator(`director`);
  executor.activateContext(`DIRECTOR`);

  let tornDown = false;
  const listener = () => {};
  executor.on(executor.hooks.SHARED.STORAGE.BEFORE, listener, { plugin: `demo`, priority: 0 });
  executor.plugins.set(`demo`, {
    name: `demo`,
    async teardown(context) {
      tornDown = context.reason === `replace` && context.contextName === `DIRECTOR`;
    }
  });

  await executor.unload(`demo`, { reason: `replace`, replacedBy: `demo` });

  assert.equal(tornDown, true);
  assert.equal(executor.plugins.has(`demo`), false);
  assert.deepEqual(executor.listeners[executor.hooks.SHARED.STORAGE.BEFORE], []);
});

test(`plugin executor rejects duplicate names unless override is explicit`, async () => {
  const executor = new PluginOrchestrator(`director`);
  executor.plugins = new Map([[`dup`, {
    name: `dup`,
    async register() {}
  }]]);

  await assert.rejects(
    () => executor.registerPlugin({
      name: `dup`,
      async register() {}
    }),
    /Duplicate plugin name/
  );
});

test(`process orchestrator records child shutdown state details and lifecycle history`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-supervisor-adapter-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  currentProcessAdapter() { return process; },`,
    `  spawnAdapter() { throw new Error('not used'); },`,
    `  initAdapter() {},`,
    `};`
  ].join(`\n`));

  const runs = [];
  const listeners = new Map();
  const rpcRouter = {
    endpoint: {
      addListener(name, handler) {
        listeners.set(name, handler);
      }
    },
    registerTarget() {},
    unregisterTarget() {},
    routeTo() {}
  };
  const kernelContext = {
    config: {
      _adapters: {
        processForkRuntime: adapterPath
      },
      processForkRuntime: {
        lifecycleHistoryMax: 10,
        defaultTimeout: 30_000
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            BOOTSTRAP: 1,
            ERROR: 2,
            READY: 3,
            SHUTDOWN: 4,
            CRASH: 5,
            RESTART: 6,
            DEAD: 7,
            HEARTBEAT: 8,
            LAUNCH: { BEFORE: 9, AFTER: 10, ERROR: 11 },
            EXIT: { BEFORE: 12, AFTER: 13, ERROR: 14 }
          }
        }
      },
      async run(hookId, payload) {
        runs.push({ hookId, payload });
      }
    },
    useCases: {
      rpcRouter
    }
  };

  const supervisor = new ProcessForkRuntime(kernelContext);
  await supervisor.rpcRouterReadyPromise;
  assert.equal(`healthSupervisor` in supervisor, false);
  supervisor.children.set(`engine_0`, { pid: 123, state: `ready` });

  const stateListener = listeners.get(`state`);
  const result = await stateListener({
    origin: `engine_0`,
    state: `shutdown`,
    source: `signal`,
    signal: `SIGTERM`
  });

  assert.deepEqual(result, { success: true });
  assert.equal(runs.at(-1).hookId, 4);
  assert.equal(runs.at(-1).payload.signal, `SIGTERM`);
  assert.deepEqual(supervisor.getLifecycleHistory(`engine_0`).map((entry) => entry.state), [`shutdown`]);
});

test(`process-firewall maps shell commands to privileged bridge operations`, () => {
  const { tryBuildBridgeRequest } = processFirewallPlugin._internal;

  assert.deepEqual(
    tryBuildBridgeRequest(`/tmp/newtork_local_proxy.sh`, [`on`, `demo`, `6379,3306`, `14002,14003`]),
    {
      operation: `firewall.localProxy.on`,
      payload: {
        processUser: `demo`,
        openLocalPortsCsv: `6379,3306`,
        proxyPortsCsv: `14002,14003`
      }
    }
  );

  assert.deepEqual(
    tryBuildBridgeRequest(`/tmp/newtork_wan_block.sh`, [`off`, `all`]),
    {
      operation: `firewall.wanBlock.offAll`,
      payload: {}
    }
  );
});

test(`process orchestrator rolls back post-spawn setup failures cleanly`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-supervisor-rollback-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `const { EventEmitter } = require('node:events');`,
    `module.exports = {`,
    `  currentProcessAdapter() { return process; },`,
    `  spawnAdapter() {`,
    `    const child = new EventEmitter();`,
    `    child.pid = 321;`,
    `    child.kill = () => { child.killed = true; };`,
    `    child.send = () => {};`,
    `    return child;`,
    `  },`,
    `  initAdapter() { throw new Error('init failed'); },`,
    `};`
  ].join(`\n`));

  let cleanupRan = false;
  let unregisterCount = 0;
  const delegated = [];
  const rpcRouter = {
    endpoint: {
      addListener() {},
      onReceive() {}
    },
    registerTarget() {},
    unregisterTarget() {
      unregisterCount += 1;
    },
    routeTo() {}
  };
  const kernelContext = {
    config: {
      _adapters: {
        processForkRuntime: adapterPath
      },
      processForkRuntime: {
        defaultTimeout: 30_000
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            BOOTSTRAP: 1,
            ERROR: 2,
            READY: 3,
            SHUTDOWN: 4,
            CRASH: 5,
            RESTART: 6,
            DEAD: 7,
            HEARTBEAT: 8,
            LAUNCH: { BEFORE: 9, AFTER: 10, ERROR: 11 },
            EXIT: { BEFORE: 12, AFTER: 13, ERROR: 14 }
          }
        }
      },
      async runWithContext(hookId, context) {
        return context;
      },
      async run() {}
    },
    useCases: {
      rpcRouter,
      watchdogOrchestrator: {
        discardProcessState(label) {
          delegated.push(label);
        }
      }
    }
  };

  const supervisor = new ProcessForkRuntime(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  await assert.rejects(
    () => supervisor.launchProcess({
      label: `e_transport_aaaaaaaaaaaa`,
      path: `/tmp/transport.js`,
      cwd: `/tmp`,
      cleanupTasks: [async () => { cleanupRan = true; }]
    }),
    /init failed/
  );

  assert.equal(supervisor.children.size, 0);
  assert.equal(supervisor.labelsByPid.size, 0);
  assert.equal(cleanupRan, true);
  assert.equal(unregisterCount, 1);
  assert.deepEqual(delegated, [`e_transport_aaaaaaaaaaaa`]);
});

test(`process orchestrator asks director to clean orphan queue tasks when a transport exits`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-supervisor-queue-cleanup-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `const { EventEmitter } = require('node:events');`,
    `module.exports = {`,
    `  currentProcessAdapter() { return process; },`,
    `  spawnAdapter() {`,
    `    const child = new EventEmitter();`,
    `    child.pid = 654;`,
    `    child.kill = () => {};`,
    `    child.send = () => {};`,
    `    child.off = child.removeListener.bind(child);`,
    `    child.once = child.once.bind(child);`,
    `    return child;`,
    `  },`,
    `  initAdapter({ managedProcess, onMessageToRootCallback, onExitCallback }) {`,
    `    managedProcess.process.on('message', onMessageToRootCallback);`,
    `    managedProcess.process.on('exit', onExitCallback);`,
    `  },`,
    `};`
  ].join(`\n`));

  const asks = [];
  const delegated = [];
  const rpcRouter = {
    endpoint: {
      addListener() {},
      onReceive() {},
      async ask(payload) {
        asks.push(payload);
        return { success: true, removed: 1 };
      }
    },
    registerTarget() {},
    unregisterTarget() {},
    routeTo() {}
  };
  const kernelContext = {
    config: {
      _adapters: {
        processForkRuntime: adapterPath
      },
      processForkRuntime: {
        defaultTimeout: 30_000
      },
      middlewareStackOrchestrator: {
        question: {
          cleanupByOrigin: `queueCleanupByOrigin`
        }
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            BOOTSTRAP: 1,
            ERROR: 2,
            READY: 3,
            SHUTDOWN: 4,
            CRASH: 5,
            RESTART: 6,
            DEAD: 7,
            HEARTBEAT: 8,
            LAUNCH: { BEFORE: 9, AFTER: 10, ERROR: 11 },
            EXIT: { BEFORE: 12, AFTER: 13, ERROR: 14 }
          }
        }
      },
      async runWithContext(hookId, context) {
        return context;
      },
      async run() {}
    },
    useCases: {
      rpcRouter,
      watchdogOrchestrator: {
        onProcessLaunch(label) {
          delegated.push({ type: `launch`, label });
        },
        async onProcessExit(label) {
          delegated.push({ type: `exit`, label });
        }
      }
    }
  };

  const supervisor = new ProcessForkRuntime(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  const managedProcess = await supervisor.launchProcess({
    label: `e_transport_aaaaaaaaaaaa`,
    path: `/tmp/transport.js`,
    cwd: `/tmp`,
    env: {}
  });

  managedProcess.process.emit(`exit`, 1, null);
  await managedProcess.exitTeardownPromise;

  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0], {
    target: `director`,
    question: `queueCleanupByOrigin`,
    data: { origin: `e_transport_aaaaaaaaaaaa` }
  });
  assert.ok(delegated.some((entry) => entry.type === `launch` && entry.label === `e_transport_aaaaaaaaaaaa`));
  assert.ok(delegated.some((entry) => entry.type === `exit` && entry.label === `e_transport_aaaaaaaaaaaa`));
});

test(`watchdog orchestrator treats coordinated signal exits as non-crash shutdowns`, () => {
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {}
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            ERROR: 1,
            HEARTBEAT: 2,
            SHUTDOWN: 3,
            CRASH: 4,
            RESTART: 5,
            DEAD: 6
          }
        }
      }
    },
    useCases: {
      processForkRuntime: {
        children: new Map(),
        recordLifecycleEvent() {},
        launchProcess() {
          throw new Error(`not used`);
        }
      },
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });

  assert.equal(watchdogOrchestrator.classifyUnexpectedExitReason({ reason: `signal`, code: 0, signal: `SIGTERM` }), null);
  assert.equal(watchdogOrchestrator.classifyUnexpectedExitReason({ reason: `shutdown`, code: 0, signal: null }), null);
});

test(`bootstrap main normalizes signal shutdown tasks to shutdown`, () => {
  const source = fs.readFileSync(path.join(__dirname, `..`, `bootstrap`, `bootstrap-main.js`), `utf8`);
  assert.match(source, /normalizeShutdownReason/);
  assert.match(source, /source === `signal`/);
  assert.match(source, /return `shutdown`/);
});

test(`multi-process orchestrator derives process label, entry, and identity from contracts`, async () => {
  const launchCalls = [];
  const orchestrator = new MultiProcessOrchestrator({
    useCases: {
      processForkRuntime: {
        getProcessByLabel() {
          return null;
        },
        async launchProcess(processOptions) {
          launchCalls.push(processOptions);
          return { label: processOptions.label };
        }
      }
    }
  });

  await orchestrator.forkProcess(`appScope`, `isolatedRuntime`, {
    tenantId: `aaaaaaaaaaaa`,
    appId: `bbbbbbbbbbbb`,
    appRoot: `/srv/apps/example`,
    appDomain: `example.test`,
    appName: `www`
  });

  assert.equal(launchCalls.length, 1);
  assert.equal(launchCalls[0].label, `e_app_aaaaaaaaaaaa_bbbbbbbbbbbb`);
  assert.equal(launchCalls[0].path, `@/bootstrap/bootstrap-isolated-runtime`);
  assert.equal(launchCalls[0].processUser, `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`);
  assert.equal(launchCalls[0].processGroup, `g_tenantScope_aaaaaaaaaaaa`);
  assert.equal(launchCalls[0].processSecondGroup, null);
  assert.equal(launchCalls[0].processThirdGroup, null);
  assert.deepEqual(launchCalls[0].variables, [
    `aaaaaaaaaaaa`,
    `bbbbbbbbbbbb`,
    `/srv/apps/example`,
    `e_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
    `example.test`,
    `www`
  ]);
});

test(`process fork runtime delegates ensureProcess RPC requests to multi-process orchestrator`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-supervisor-ensure-rpc-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  currentProcessAdapter() { return process; },`,
    `  spawnAdapter() { throw new Error('not used'); },`,
    `  initAdapter() {},`,
    `};`
  ].join(`\n`));

  const listeners = new Map();
  const delegatedCalls = [];
  const rpcRouter = {
    endpoint: {
      addListener(name, handler) {
        listeners.set(name, handler);
      }
    },
    registerTarget() {},
    unregisterTarget() {},
    routeTo() {}
  };

  const kernelContext = {
    config: {
      _adapters: {
        processForkRuntime: adapterPath
      },
      processForkRuntime: {
        question: {
          ensureProcess: `ensureProcess`
        }
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            BOOTSTRAP: 1,
            ERROR: 2,
            READY: 3,
            SHUTDOWN: 4,
            CRASH: 5,
            RESTART: 6,
            DEAD: 7,
            HEARTBEAT: 8,
            LAUNCH: { BEFORE: 9, AFTER: 10, ERROR: 11 },
            EXIT: { BEFORE: 12, AFTER: 13, ERROR: 14 }
          }
        }
      },
      async run() {}
    },
    useCases: {
      rpcRouter,
      multiProcessOrchestrator: {
        async ensureProcess(layerKey, processKey, context) {
          delegatedCalls.push({ layerKey, processKey, context });
          return { success: true, skipped: false, layerKey, processKey };
        }
      }
    }
  };

  const supervisor = new ProcessForkRuntime(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  const ensureProcessListener = listeners.get(`ensureProcess`);
  const response = await ensureProcessListener({
    layerKey: `tenantScope`,
    processKey: `transport`,
    context: {
      tenantId: `aaaaaaaaaaaa`,
      tenantDomain: `example.test`
    },
    reason: `tenancy_scan_ensure`
  });

  assert.deepEqual(response, {
    success: true,
    skipped: false,
    layerKey: `tenantScope`,
    processKey: `transport`
  });
  assert.deepEqual(delegatedCalls, [{
    layerKey: `tenantScope`,
    processKey: `transport`,
    context: delegatedCalls[0].context
  }]);
  assert.equal(delegatedCalls[0].context.tenantId, `aaaaaaaaaaaa`);
  assert.equal(delegatedCalls[0].context.tenantDomain, `example.test`);
  assert.equal(delegatedCalls[0].context.reason, `tenancy_scan_ensure`);
});

test(`process orchestrator exposes grouped child-process counts and serves them through RPC`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-supervisor-process-counts-`));
  const adapterPath = path.join(tempDir, `adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  currentProcessAdapter() { return process; },`,
    `  spawnAdapter() { throw new Error('not used'); },`,
    `  initAdapter() {},`,
    `};`
  ].join(`\n`));

  const listeners = new Map();
  const rpcRouter = {
    endpoint: {
      addListener(name, handler) {
        listeners.set(name, handler);
      }
    },
    registerTarget() {},
    unregisterTarget() {},
    routeTo() {}
  };
  const kernelContext = {
    config: {
      _adapters: {
        processForkRuntime: adapterPath
      },
      processForkRuntime: {
        defaultTimeout: 30_000,
        question: {
          processCounts: `processCounts`
        }
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            BOOTSTRAP: 1,
            ERROR: 2,
            READY: 3,
            SHUTDOWN: 4,
            CRASH: 5,
            RESTART: 6,
            DEAD: 7,
            HEARTBEAT: 8,
            LAUNCH: { BEFORE: 9, AFTER: 10, ERROR: 11 },
            EXIT: { BEFORE: 12, AFTER: 13, ERROR: 14 }
          }
        }
      },
      async run() {}
    },
    useCases: {
      rpcRouter
    }
  };

  const supervisor = new ProcessForkRuntime(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  supervisor.children.set(`director`, { label: `director`, pid: 11, state: `ready` });
  supervisor.children.set(`e_transport_aaaaaaaaaaaa`, { label: `e_transport_aaaaaaaaaaaa`, pid: 21, state: `ready` });
  supervisor.children.set(`e_transport_bbbbbbbbbbbb`, { label: `e_transport_bbbbbbbbbbbb`, pid: 22, state: `ready` });
  supervisor.children.set(`e_app_aaaaaaaaaaaa_bbbbbbbbbbbb`, { label: `e_app_aaaaaaaaaaaa_bbbbbbbbbbbb`, pid: 31, state: `ready` });
  supervisor.children.set(`custom_worker`, { label: `custom_worker`, pid: 41, state: `ready` });

  assert.deepEqual(supervisor.getProcessCountsSnapshot(), {
    total: 5,
    director: 1,
    transport: 2,
    isolatedRuntime: 1,
    other: 1
  });

  const processCountsListener = listeners.get(`processCounts`);
  const response = await processCountsListener({});
  assert.deepEqual(response, {
    success: true,
    counts: {
      total: 5,
      director: 1,
      transport: 2,
      isolatedRuntime: 1,
      other: 1
    }
  });
});

test(`watchdog orchestrator triggers reload when a heartbeat turns unhealthy`, async () => {
  const processForkRuntime = {
    children: new Map([[`engine_0`, { pid: 88 }]]),
    recordLifecycleEvent() {}
  };
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {
          maxElu: 0.5,
          maxLagP99Ms: 100,
          maxLagMaxMs: 500
        }
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            HEARTBEAT: 1,
            ERROR: 2
          }
        }
      },
      run() {
        return Promise.resolve();
      }
    },
    useCases: {
      processForkRuntime,
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });

  const reloadCalls = [];
  watchdogOrchestrator.reloadProcess = (label, reason) => {
    reloadCalls.push({ label, reason });
    return true;
  };

  const result = await watchdogOrchestrator.handleHeartbeat({
    origin: `engine_0`,
    elu: 0.9,
    lagP99Ms: 10,
    lagMaxMs: 10
  });

  assert.deepEqual(result, {
    success: true,
    healthy: false,
    action: `reloading`,
    reason: `elu`
  });
  assert.deepEqual(reloadCalls, [{ label: `engine_0`, reason: `heartbeat_unhealthy` }]);
});

test(`watchdog orchestrator caches the latest process health snapshot`, async () => {
  const processForkRuntime = {
    children: new Map([[`engine_0`, { pid: 88 }]]),
    recordLifecycleEvent() {}
  };
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {}
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            HEARTBEAT: 1,
            ERROR: 2
          }
        }
      },
      run() {
        return Promise.resolve();
      }
    },
    useCases: {
      processForkRuntime,
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });

  const payload = {
    origin: `engine_0`,
    elu: 0.1,
    lagP99Ms: 12,
    lagMaxMs: 24
  };

  await watchdogOrchestrator.handleHeartbeat(payload);

  const health = watchdogOrchestrator.getProcessHealth(`engine_0`);
  assert.equal(health.healthy, true);
  assert.equal(health.reason, null);
  assert.equal(health.elu, 0.1);
  assert.equal(health.lagP99Ms, 12);
  assert.equal(health.lagMaxMs, 24);
  assert.deepEqual(health.limits, {
    maxElu: 0.98,
    maxLagP99Ms: 500,
    maxLagMaxMs: 1500
  });
  assert.deepEqual(health.payload, payload);
  assert.equal(typeof health.observedAt, `number`);
});

test(`watchdog orchestrator settles reload relaunch failures into crash and dead history`, async () => {
  const emitted = [];
  const managedProcess = {
    pid: 77,
    label: `e_transport_aaaaaaaaaaaa`,
    path: `/tmp/engine.js`,
    cwd: `/tmp`,
    processUser: `ubuntu`,
    variables: [],
    serialization: `json`,
    env: {},
    restartOnExit: false,
    exitReason: null,
    listeners() {
      return [];
    },
    process: new EventEmitter()
  };
  managedProcess.process.send = () => {
    process.nextTick(() => managedProcess.process.emit(`exit`, 1, null));
  };
  managedProcess.process.kill = () => {};

  const history = [];
  const processForkRuntime = {
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      return Promise.reject(new Error(`relaunch failed`));
    },
    recordLifecycleEvent(event) {
      history.push(event);
    }
  };
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {}
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            ERROR: 1,
            RESTART: 2,
            SHUTDOWN: 3,
            CRASH: 4,
            DEAD: 5
          }
        }
      },
      run(hookId, payload) {
        emitted.push({ hookId, payload });
        return Promise.resolve();
      }
    },
    useCases: {
      processForkRuntime,
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });

  const reloading = watchdogOrchestrator.reloadProcess(`engine_0`, `heartbeat_timeout`);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reloading, true);
  assert.ok(history.some((entry) => entry.type === `reload_requested`));
  assert.ok(history.some((entry) => entry.type === `crash` && entry.reason === `reload_restart_failed`));
  assert.ok(history.some((entry) => entry.type === `dead` && entry.reason === `reload_failed`));
  assert.ok(emitted.some((entry) => entry.hookId === 4));
  assert.ok(emitted.some((entry) => entry.hookId === 5));
});

test(`watchdog orchestrator clears reload lock when force-killed process still does not exit`, async () => {
  const emitted = [];
  const managedProcess = {
    pid: 91,
    label: `e_transport_aaaaaaaaaaaa`,
    path: `/tmp/engine.js`,
    cwd: `/tmp`,
    processUser: `ubuntu`,
    variables: [],
    serialization: `json`,
    env: {},
    restartOnExit: false,
    exitReason: null,
    listeners() {
      return [];
    },
    process: new EventEmitter()
  };
  managedProcess.process.send = () => {};
  managedProcess.process.kill = () => {};

  const history = [];
  const processForkRuntime = {
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      throw new Error(`launchProcess should not be called without exit`);
    },
    recordLifecycleEvent(event) {
      history.push(event);
    }
  };
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {},
        reloadGracefulExitTimeoutMs: 10,
        reloadForceKillFailSafeTimeoutMs: 10
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            ERROR: 1,
            RESTART: 2,
            SHUTDOWN: 3,
            CRASH: 4,
            DEAD: 5
          }
        }
      },
      run(hookId, payload) {
        emitted.push({ hookId, payload });
        return Promise.resolve();
      }
    },
    useCases: {
      processForkRuntime,
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });
  const reloading = watchdogOrchestrator.reloadProcess(`engine_0`, `heartbeat_timeout`);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(reloading, true);
  assert.equal(watchdogOrchestrator.reloadingLabels.has(`engine_0`), false);
  assert.ok(history.some((entry) => entry.type === `crash` && entry.reason === `graceful_exit_timeout`));
  assert.ok(history.some((entry) => entry.type === `dead` && entry.reason === `reload_force_kill_no_exit`));
  assert.ok(emitted.some((entry) => entry.hookId === 5 && entry.payload?.reason === `reload_force_kill_no_exit`));
});

test(`watchdog orchestrator sends drain command during reload requests`, async () => {
  const sentMessages = [];
  const managedProcess = {
    pid: 77,
    label: `e_transport_aaaaaaaaaaaa`,
    path: `/tmp/engine.js`,
    cwd: `/tmp`,
    processUser: `ubuntu`,
    variables: [],
    serialization: `json`,
    env: {},
    restartOnExit: false,
    exitReason: null,
    listeners() {
      return [];
    },
    process: new EventEmitter()
  };
  managedProcess.process.send = (message) => {
    sentMessages.push(message);
    process.nextTick(() => managedProcess.process.emit(`exit`, 1, null));
  };
  managedProcess.process.kill = () => {};

  const processForkRuntime = {
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      return Promise.resolve({
        pid: 78,
        on() {}
      });
    },
    recordLifecycleEvent() {}
  };
  const watchdogOrchestrator = new WatchdogOrchestrator({
    config: {
      watchdogOrchestrator: {
        heartbeat: {},
        reloadDrainTimeoutMs: 321
      }
    },
    pluginOrchestrator: {
      processLabel: `main`,
      hooks: {
        MAIN: {
          SUPERVISOR: {
            ERROR: 1,
            RESTART: 2,
            SHUTDOWN: 3,
            CRASH: 4,
            DEAD: 5
          }
        }
      },
      run() {
        return Promise.resolve();
      }
    },
    useCases: {
      processForkRuntime,
      rpcRouter: {
        endpoint: {
          addListener() {}
        }
      }
    }
  });
  const reloading = watchdogOrchestrator.reloadProcess(`engine_0`, `manual_reload`);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reloading, true);
  assert.deepEqual(sentMessages[0], {
    __supervisorCommand: `drain`,
    code: 1,
    reason: `manual_reload`,
    timeoutMs: 321
  });
});

test(`process orchestrator shutdown sends drain command with timeout`, async () => {
  const sentMessages = [];
  const managedProcess = {
    label: `e_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
    pid: 88,
    process: new EventEmitter(),
    restartOnExit: false,
    exitReason: null,
    exitTeardownPromise: Promise.resolve()
  };
  managedProcess.process.send = (message) => {
    sentMessages.push(message);
    process.nextTick(() => managedProcess.process.emit(`exit`, 0, null));
  };
  managedProcess.process.kill = () => {};
  managedProcess.process.off = managedProcess.process.removeListener.bind(managedProcess.process);
  managedProcess.process.once = managedProcess.process.once.bind(managedProcess.process);

  const processForkRuntime = {
    config: {
      defaultTimeout: 30_000
    },
    children: new Map([[managedProcess.label, managedProcess]])
  };

  const result = await ProcessForkRuntime.prototype.shutdownProcess.call(
    processForkRuntime,
    managedProcess.label,
    `shutdown`,
    456
  );

  assert.equal(result, true);
  assert.deepEqual(sentMessages[0], {
    __supervisorCommand: `drain`,
    code: 0,
    reason: `shutdown`,
    timeoutMs: 456
  });
});
