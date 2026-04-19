'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const PluginOrchestrator = require(`@/_core/orchestrators/plugin-orchestrator`);
const { createHourlyFileLogger } = require(`@/utils/logger/hourly-file-logger`);

const CONTRACT_PATH = require.resolve(`@/contracts/layers/supervision-scope.contract.js`);
const PLUGIN_PATH = path.join(
  __dirname,
  `..`,
  `builtin-extensions`,
  `plugins`,
  `error-reporter.js`
);
const CONTEXTS = [`MAIN`, `DIRECTOR`, `TRANSPORT`, `ISOLATED_RUNTIME`];

test(`error-reporter registers PROCESS.ERROR for every supported process context and writes hourly files`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-error-reporter-`));
  const restore = loadErrorReporterWithErrorRoot(baseDir);
  const plugin = require(PLUGIN_PATH);
  const originalConsoleError = console.error;
  const consoleLines = [];
  console.error = (...args) => {
    consoleLines.push(args.join(` `));
  };

  try {
    for (const contextName of CONTEXTS) {
      const executor = new PluginOrchestrator(`process-${contextName.toLowerCase()}`);
      executor.activateContext(contextName);
      await plugin.register(executor);
      await executor.run(executor.hooks[contextName].PROCESS.ERROR, {
        error: new Error(`boom-${contextName.toLowerCase()}`),
        source: `test-source`,
        reason: `test-reason`
      });
      await plugin.teardown();
    }

    const hourFile = path.join(baseDir, `${new Date().toISOString().slice(0, 13)}.log`);
    const fileContents = fs.readFileSync(hourFile, `utf8`);

    for (const contextName of CONTEXTS) {
      assert.match(fileContents, new RegExp(`context=${contextName}`));
      assert.match(fileContents, new RegExp(`boom-${contextName.toLowerCase()}`));
      assert.match(consoleLines.join(`\n`), new RegExp(`context=${contextName}`));
    }
  } finally {
    console.error = originalConsoleError;
    restore();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test(`error-reporter appends multiple recent errors in the same hour to one file`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-error-reporter-hour-`));
  const restore = loadErrorReporterWithErrorRoot(baseDir);
  const plugin = require(PLUGIN_PATH);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const executor = new PluginOrchestrator(`process-main`);
    executor.activateContext(`MAIN`);
    await plugin.register(executor);

    await executor.run(executor.hooks.MAIN.PROCESS.ERROR, {
      error: new Error(`first-error`)
    });
    await executor.run(executor.hooks.MAIN.PROCESS.ERROR, {
      error: new Error(`second-error`)
    });
    await plugin.teardown();

    const hourFile = path.join(baseDir, `${new Date().toISOString().slice(0, 13)}.log`);
    const fileContents = fs.readFileSync(hourFile, `utf8`);
    assert.match(fileContents, /first-error/);
    assert.match(fileContents, /second-error/);
  } finally {
    console.error = originalConsoleError;
    restore();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test(`error-reporter keeps plugin execution resilient when hourly file writes fail`, async () => {
  const restore = loadErrorReporterWithErrorRoot(`/proc/ehecoatl-error-reporter-test`);
  const plugin = require(PLUGIN_PATH);
  const originalConsoleError = console.error;
  const consoleLines = [];
  console.error = (...args) => {
    consoleLines.push(args.join(` `));
  };

  try {
    const executor = new PluginOrchestrator(`process-main`);
    executor.activateContext(`MAIN`);
    await plugin.register(executor);

    await assert.doesNotReject(() => executor.run(executor.hooks.MAIN.PROCESS.ERROR, {
      error: new Error(`write-failure-safe`)
    }));

    assert.match(consoleLines.join(`\n`), /write-failure-safe/);
    await plugin.teardown();
  } finally {
    console.error = originalConsoleError;
    restore();
  }
});

test(`hourly file logger supports direct hourly root retention for the last 24 files`, async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-direct-hourly-`));

  try {
    const createdFiles = [];
    for (let i = 0; i < 26; i++) {
      const filePath = path.join(baseDir, `2026-04-18T${String(i).padStart(2, `0`)}.log`);
      fs.writeFileSync(filePath, `line-${i}\n`, `utf8`);
      const mtime = new Date(Date.now() - (26 - i) * 1000);
      fs.utimesSync(filePath, mtime, mtime);
      createdFiles.push(filePath);
    }

    const logger = createHourlyFileLogger({
      enabled: true,
      baseDir,
      maxFiles: 24,
      cleanupIntervalMs: 100000,
      directHourlyRoot: true
    });

    logger.writeError(`trigger-cleanup`);
    await new Promise((resolve) => setImmediate(resolve));

    const remainingFiles = fs.readdirSync(baseDir).filter((entry) => entry.endsWith(`.log`));
    assert.ok(remainingFiles.length <= 24);
    logger.close();
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function loadErrorReporterWithErrorRoot(errorRoot) {
  const originalContractEntry = require.cache[CONTRACT_PATH];
  const originalPluginEntry = require.cache[PLUGIN_PATH];
  const originalContract = require(CONTRACT_PATH);

  delete require.cache[PLUGIN_PATH];
  require.cache[CONTRACT_PATH] = {
    id: CONTRACT_PATH,
    filename: CONTRACT_PATH,
    loaded: true,
    exports: Object.freeze({
      ...originalContract,
      PATHS: Object.freeze({
        ...originalContract.PATHS,
        LOGS: Object.freeze({
          ...originalContract.PATHS.LOGS,
          error: Object.freeze([errorRoot])
        })
      })
    })
  };

  return function restore() {
    delete require.cache[PLUGIN_PATH];
    if (originalContractEntry) {
      require.cache[CONTRACT_PATH] = originalContractEntry;
    } else {
      delete require.cache[CONTRACT_PATH];
    }
    if (originalPluginEntry) {
      require.cache[PLUGIN_PATH] = originalPluginEntry;
    }
  };
}
