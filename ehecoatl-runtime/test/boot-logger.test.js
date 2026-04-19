'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const bootLogger = require(`@plugin/boot-logger`);
const PluginOrchestrator = require(`@/_core/orchestrators/plugin-orchestrator`);

test(`boot-logger writes bootstrap payloads to the configured boot log root and console`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-boot-logger-`));
  const captured = [];
  const originalLog = console.log;
  let listener = null;

  console.log = (line) => captured.push(line);

  try {
    await bootLogger.register.call(bootLogger, {
      currentContextName: `MAIN`,
      hooks: {
        MAIN: {
          PROCESS: {
            BOOTSTRAP: 1
          }
        }
      },
      on(hookId, fn) {
        assert.equal(hookId, 1);
        listener = fn;
      },
      getPluginConfig() {
        return {
          console: true,
          fileLogging: {
            baseDir: tempDir,
            enabled: true,
            maxFiles: 24,
            cleanupIntervalMs: 0
          }
        };
      }
    });

    await listener({
      processLabel: `main`,
      message: `BOOTSTRAP: MAIN`,
      lines: [`custom boot line`],
      source: `test`,
      stage: `kernel-ready`,
      data: { ok: true }
    });

    const logContent = readOnlyLogContent(tempDir);
    assert.match(logContent, /process bootstrap/);
    assert.match(logContent, /context=MAIN/);
    assert.match(logContent, /processLabel=main/);
    assert.match(logContent, /source=test/);
    assert.match(logContent, /stage=kernel-ready/);
    assert.match(logContent, /BOOTSTRAP: MAIN/);
    assert.match(logContent, /custom boot line/);
    assert.match(logContent, /data=\{"ok":true\}/);
    assert.ok(captured.some((line) => line.includes(`BOOTSTRAP: MAIN`)));
  } finally {
    console.log = originalLog;
    await bootLogger.teardown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`boot-logger suppresses console output when configured and handles empty payloads`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-boot-logger-empty-`));
  const captured = [];
  const originalLog = console.log;
  let listener = null;

  console.log = (line) => captured.push(line);

  try {
    await bootLogger.register.call(bootLogger, {
      currentContextName: `DIRECTOR`,
      hooks: {
        DIRECTOR: {
          PROCESS: {
            BOOTSTRAP: 2
          }
        }
      },
      on(hookId, fn) {
        assert.equal(hookId, 2);
        listener = fn;
      },
      getPluginConfig() {
        return {
          console: false,
          fileLogging: {
            baseDir: tempDir,
            enabled: true,
            maxFiles: 24,
            cleanupIntervalMs: 0
          }
        };
      }
    });

    await listener();

    const logContent = readOnlyLogContent(tempDir);
    assert.match(logContent, /process bootstrap/);
    assert.match(logContent, /context=DIRECTOR/);
    assert.equal(captured.length, 0);
  } finally {
    console.log = originalLog;
    await bootLogger.teardown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`boot-logger forwards boot lines instead of writing locally when a forwarder is provided`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-boot-logger-forward-`));
  const forwarded = [];
  let listener = null;

  try {
    await bootLogger.register.call(bootLogger, {
      currentContextName: `TRANSPORT`,
      hooks: {
        TRANSPORT: {
          PROCESS: {
            BOOTSTRAP: 3
          }
        }
      },
      on(hookId, fn) {
        assert.equal(hookId, 3);
        listener = fn;
      },
      getPluginConfig() {
        return {
          console: false,
          fileLogging: {
            baseDir: tempDir,
            enabled: true,
            maxFiles: 24,
            cleanupIntervalMs: 0
          }
        };
      }
    });

    await listener({
      processLabel: `transport`,
      message: `BOOTSTRAP: TRANSPORT`,
      forwardBootLogLines(lines) {
        forwarded.push(...lines);
      }
    });

    assert.ok(forwarded.some((line) => line.includes(`context=TRANSPORT`)));
    assert.ok(forwarded.some((line) => line.includes(`BOOTSTRAP: TRANSPORT`)));
    assert.equal(fs.existsSync(tempDir) && fs.readdirSync(tempDir).some((entry) => entry.endsWith(`.log`)), false);
  } finally {
    await bootLogger.teardown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`boot-logger registers through PluginOrchestrator on process bootstrap`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-boot-logger-orchestrator-`));
  const executor = new PluginOrchestrator(`main`, {
    'boot-logger': {
      console: false,
      fileLogging: {
        baseDir: tempDir,
        enabled: true,
        maxFiles: 24,
        cleanupIntervalMs: 0
      }
    }
  });

  executor.activateContext(`MAIN`);

  try {
    await executor.registerPlugin(bootLogger);
    await executor.run(executor.hooks.MAIN.PROCESS.BOOTSTRAP, {
      message: `BOOTSTRAP: MAIN`,
      source: `plugin-orchestrator-test`
    });

    const logContent = readOnlyLogContent(tempDir);
    assert.match(logContent, /BOOTSTRAP: MAIN/);
    assert.match(logContent, /source=plugin-orchestrator-test/);
  } finally {
    await executor.destroy().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function readOnlyLogContent(rootDir) {
  const files = fs.readdirSync(rootDir)
    .filter((entry) => entry.endsWith(`.log`))
    .map((entry) => path.join(rootDir, entry));

  assert.ok(files.length > 0, `expected at least one boot log file in ${rootDir}`);
  return files.map((filePath) => fs.readFileSync(filePath, `utf8`)).join(`\n`);
}
