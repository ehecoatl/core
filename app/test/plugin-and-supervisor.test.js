// test/plugin-and-supervisor.test.js


'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { EventEmitter } = require(`node:events`);

const PluginExecutor = require(`@/_core/boot/plugin-executor`);
const pluginScan = require(`@/utils/plugin-scan`);
const ProcessSupervisor = require(`g@/main/process-supervisor/process-supervisor`);
const HealthSupervisor = require(`g@/main/process-supervisor/health-supervisor`);

test(`plugin scan respects explicit context activation`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-plugin-scan-`));
  const pluginPath = path.join(tempDir, `context-only.js`);
  fs.writeFileSync(pluginPath, [
    `'use strict';`,
    `module.exports = {`,
    `  name: 'context-only',`,
    `  contexts: ['TENANT'],`,
    `  async register(executor) { executor.on(executor.hooks.SHARED.STORAGE.BEFORE, () => {}, this.pluginMeta); },`,
    `  get pluginMeta() { return { plugin: this.name, priority: 0 }; }`,
    `};`
  ].join(`\n`));

  const executor = new PluginExecutor(`manager`);
  executor.min = executor.hooks.MANAGER.min;
  executor.max = executor.hooks.MANAGER.max;
  executor.sharedMin = executor.hooks.SHARED.min;
  executor.sharedMax = executor.hooks.SHARED.max;
  executor.plugins = new Map();

  const loaded = await pluginScan(executor, tempDir, {
    'logger-runtime': { enabled: false },
    'error-reporter': { enabled: false }
  }, `MANAGER`);

  assert.equal(loaded.has(`context-only`), false);
});

test(`plugin executor teardown runs before unload removes listeners`, async () => {
  const executor = new PluginExecutor(`manager`);
  executor.plugins = new Map();
  executor.currentContextName = `MANAGER`;
  executor.min = executor.hooks.MANAGER.min;
  executor.max = executor.hooks.MANAGER.max;
  executor.sharedMin = executor.hooks.SHARED.min;
  executor.sharedMax = executor.hooks.SHARED.max;

  let tornDown = false;
  const listener = () => {};
  executor.on(executor.hooks.SHARED.STORAGE.BEFORE, listener, { plugin: `demo`, priority: 0 });
  executor.plugins.set(`demo`, {
    name: `demo`,
    async teardown(context) {
      tornDown = context.reason === `replace` && context.contextName === `MANAGER`;
    }
  });

  await executor.unload(`demo`, { reason: `replace`, replacedBy: `demo` });

  assert.equal(tornDown, true);
  assert.equal(executor.plugins.has(`demo`), false);
  assert.deepEqual(executor.listeners[executor.hooks.SHARED.STORAGE.BEFORE], []);
});

test(`plugin executor rejects duplicate names unless override is explicit`, async () => {
  const executor = new PluginExecutor(`manager`);
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

test(`process supervisor records child shutdown state details and lifecycle history`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-supervisor-adapter-`));
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
        processSupervisor: adapterPath
      },
      processSupervisor: {
        lifecycleHistoryMax: 10,
        heartbeat: {},
        defaultTimeout: 30_000
      }
    },
    plugin: {
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
    gateways: {
      rpcRouter
    }
  };

  const supervisor = new ProcessSupervisor(kernelContext);
  await supervisor.rpcRouterReadyPromise;
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

test(`process supervisor rolls back post-spawn setup failures cleanly`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-supervisor-rollback-`));
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
        processSupervisor: adapterPath
      },
      processSupervisor: {
        heartbeat: {},
        defaultTimeout: 30_000
      }
    },
    plugin: {
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
    gateways: {
      rpcRouter
    }
  };

  const supervisor = new ProcessSupervisor(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  await assert.rejects(
    () => supervisor.launchProcess({
      label: `engine_0`,
      path: `/tmp/engine.js`,
      cwd: `/tmp`,
      cleanupTasks: [async () => { cleanupRan = true; }]
    }),
    /init failed/
  );

  assert.equal(supervisor.children.size, 0);
  assert.equal(supervisor.labelsByPid.size, 0);
  assert.equal(cleanupRan, true);
  assert.equal(unregisterCount, 1);
});

test(`process supervisor asks manager to clean orphan queue tasks when an engine exits`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-supervisor-queue-cleanup-`));
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
        processSupervisor: adapterPath
      },
      processSupervisor: {
        heartbeat: {},
        defaultTimeout: 30_000
      },
      requestPipeline: {
        question: {
          cleanupByOrigin: `queueCleanupByOrigin`
        }
      }
    },
    plugin: {
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
    gateways: {
      rpcRouter
    }
  };

  const supervisor = new ProcessSupervisor(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  const managedProcess = await supervisor.launchProcess({
    label: `engine_0`,
    path: `/tmp/engine.js`,
    cwd: `/tmp`,
    env: {}
  });

  managedProcess.process.emit(`exit`, 1, null);
  await managedProcess.exitTeardownPromise;

  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0], {
    target: `manager`,
    question: `queueCleanupByOrigin`,
    data: { origin: `engine_0` }
  });
});

test(`health supervisor treats coordinated signal exits as non-crash shutdowns`, () => {
  const supervisor = new HealthSupervisor({
    plugin: { hooks: { MAIN: { SUPERVISOR: { ERROR: 1, HEARTBEAT: 2, SHUTDOWN: 3, CRASH: 4, RESTART: 5, DEAD: 6 } } } },
    config: {
      heartbeat: {},
      defaultTimeout: 30_000
    },
    children: new Map(),
    recordLifecycleEvent() {},
    launchProcess() {
      throw new Error(`not used`);
    }
  });

  assert.equal(supervisor.classifyUnexpectedExitReason({ reason: `signal`, code: 0, signal: `SIGTERM` }), null);
  assert.equal(supervisor.classifyUnexpectedExitReason({ reason: `shutdown`, code: 0, signal: null }), null);
});

test(`bootstrap main normalizes signal shutdown tasks to shutdown`, () => {
  const source = fs.readFileSync(path.join(process.cwd(), `app/bootstrap/bootstrap-main.js`), `utf8`);
  assert.match(source, /normalizeShutdownReason/);
  assert.match(source, /source === `signal`/);
  assert.match(source, /return `shutdown`/);
});

test(`process supervisor exposes grouped child-process counts and serves them through RPC`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecatl-supervisor-process-counts-`));
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
        processSupervisor: adapterPath
      },
      processSupervisor: {
        heartbeat: {},
        defaultTimeout: 30_000,
        question: {
          processCounts: `processCounts`
        }
      }
    },
    plugin: {
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
    gateways: {
      rpcRouter
    }
  };

  const supervisor = new ProcessSupervisor(kernelContext);
  await supervisor.rpcRouterReadyPromise;

  supervisor.children.set(`manager`, { label: `manager`, pid: 11, state: `ready` });
  supervisor.children.set(`engine_0`, { label: `engine_0`, pid: 21, state: `ready` });
  supervisor.children.set(`engine_1`, { label: `engine_1`, pid: 22, state: `ready` });
  supervisor.children.set(`tenant_www.example.com`, { label: `tenant_www.example.com`, pid: 31, state: `ready` });
  supervisor.children.set(`custom_worker`, { label: `custom_worker`, pid: 41, state: `ready` });

  assert.deepEqual(supervisor.getProcessCountsSnapshot(), {
    total: 5,
    manager: 1,
    engine: 2,
    tenant: 1,
    other: 1
  });

  const processCountsListener = listeners.get(`processCounts`);
  const response = await processCountsListener({});
  assert.deepEqual(response, {
    success: true,
    counts: {
      total: 5,
      manager: 1,
      engine: 2,
      tenant: 1,
      other: 1
    }
  });
});

test(`health supervisor triggers reload when a heartbeat turns unhealthy`, async () => {
  const processSupervisor = {
    plugin: {
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
    config: {
      heartbeat: {
        maxElu: 0.5,
        maxLagP99Ms: 100,
        maxLagMaxMs: 500
      },
      defaultTimeout: 30_000
    },
    children: new Map([[`engine_0`, { pid: 88 }]]),
    recordLifecycleEvent() {}
  };

  const healthSupervisor = new HealthSupervisor(processSupervisor);
  const reloadCalls = [];
  healthSupervisor.reloadProcess = (label, reason) => {
    reloadCalls.push({ label, reason });
    return true;
  };

  const result = await healthSupervisor.handleHeartbeat({
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

test(`health supervisor settles reload relaunch failures into crash and dead history`, async () => {
  const emitted = [];
  const managedProcess = {
    pid: 77,
    label: `engine_0`,
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
  const processSupervisor = {
    plugin: {
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
    config: {
      heartbeat: {},
      defaultTimeout: 30_000
    },
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      return Promise.reject(new Error(`relaunch failed`));
    },
    recordLifecycleEvent(event) {
      history.push(event);
    }
  };

  const healthSupervisor = new HealthSupervisor(processSupervisor);
  const reloading = healthSupervisor.reloadProcess(`engine_0`, `heartbeat_timeout`);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reloading, true);
  assert.ok(history.some((entry) => entry.type === `reload_requested`));
  assert.ok(history.some((entry) => entry.type === `crash` && entry.reason === `reload_restart_failed`));
  assert.ok(history.some((entry) => entry.type === `dead` && entry.reason === `reload_failed`));
  assert.ok(emitted.some((entry) => entry.hookId === 4));
  assert.ok(emitted.some((entry) => entry.hookId === 5));
});

test(`health supervisor clears reload lock when force-killed process still does not exit`, async () => {
  const emitted = [];
  const managedProcess = {
    pid: 91,
    label: `engine_0`,
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
  const processSupervisor = {
    plugin: {
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
    config: {
      heartbeat: {},
      defaultTimeout: 30_000,
      reloadGracefulExitTimeoutMs: 10,
      reloadForceKillFailSafeTimeoutMs: 10
    },
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      throw new Error(`launchProcess should not be called without exit`);
    },
    recordLifecycleEvent(event) {
      history.push(event);
    }
  };

  const healthSupervisor = new HealthSupervisor(processSupervisor);
  const reloading = healthSupervisor.reloadProcess(`engine_0`, `heartbeat_timeout`);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(reloading, true);
  assert.equal(healthSupervisor.reloadingLabels.has(`engine_0`), false);
  assert.ok(history.some((entry) => entry.type === `crash` && entry.reason === `graceful_exit_timeout`));
  assert.ok(history.some((entry) => entry.type === `dead` && entry.reason === `reload_force_kill_no_exit`));
  assert.ok(emitted.some((entry) => entry.hookId === 5 && entry.payload?.reason === `reload_force_kill_no_exit`));
});

test(`health supervisor sends drain command during reload requests`, async () => {
  const sentMessages = [];
  const managedProcess = {
    pid: 77,
    label: `engine_0`,
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

  const processSupervisor = {
    plugin: {
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
    config: {
      heartbeat: {},
      defaultTimeout: 30_000,
      reloadDrainTimeoutMs: 321
    },
    children: new Map([[`engine_0`, managedProcess]]),
    launchProcess() {
      return Promise.resolve({
        pid: 78,
        on() {}
      });
    },
    recordLifecycleEvent() {}
  };

  const healthSupervisor = new HealthSupervisor(processSupervisor);
  const reloading = healthSupervisor.reloadProcess(`engine_0`, `manual_reload`);
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

test(`process supervisor shutdown sends drain command with timeout`, async () => {
  const sentMessages = [];
  const managedProcess = {
    label: `tenant_www.example.com`,
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

  const processSupervisor = {
    config: {
      defaultTimeout: 30_000
    },
    children: new Map([[managedProcess.label, managedProcess]])
  };

  const result = await ProcessSupervisor.prototype.shutdownProcess.call(
    processSupervisor,
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
