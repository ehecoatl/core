'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { spawnSync } = require(`node:child_process`);

const {
  applyNoSpawnFilter,
  dropAllCapabilities,
  loadNativeSeccompAddon,
  resolveSeccompMode
} = require(`@/utils/process/seccomp`);

test(`resolveSeccompMode defaults to enforce and honors env override`, () => {
  assert.equal(resolveSeccompMode({
    env: {},
    securityConfigPath: path.join(os.tmpdir(), `missing-security-${Date.now()}.json`)
  }), `enforce`);

  assert.equal(resolveSeccompMode({
    env: {
      EHECOATL_SECCOMP_MODE: `warn`
    },
    securityConfigPath: path.join(os.tmpdir(), `missing-security-${Date.now()}-2.json`)
  }), `warn`);
});

test(`resolveSeccompMode reads grouped runtime security config`, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-seccomp-config-`));
  const securityConfigPath = path.join(tempDir, `security.json`);

  try {
    fs.writeFileSync(securityConfigPath, JSON.stringify({
      seccomp: {
        mode: `warn`
      }
    }));

    assert.equal(resolveSeccompMode({
      env: {},
      securityConfigPath
    }), `warn`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`applyNoSpawnFilter throws in enforce mode when addon load fails`, () => {
  assert.throws(() => applyNoSpawnFilter({
    mode: `enforce`,
    processLabel: `director`,
    loadAddon: () => {
      throw new Error(`addon unavailable`);
    }
  }), /requires seccomp fork\/exec isolation/);
});

test(`applyNoSpawnFilter warns in warn mode when addon load fails`, () => {
  const warnings = [];
  const result = applyNoSpawnFilter({
    mode: `warn`,
    processLabel: `transport`,
    loadAddon: () => {
      throw new Error(`addon unavailable`);
    },
    logger: {
      warn(value) {
        warnings.push(String(value));
      }
    }
  });

  assert.equal(result.applied, false);
  assert.equal(result.warned, true);
  assert.equal(warnings.some((entry) => entry.includes(`continuing without fork/exec seccomp protection`)), true);
});

test(`dropAllCapabilities delegates to the native addon export`, () => {
  let called = false;

  const result = dropAllCapabilities({
    loadAddon: () => ({
      dropAllCapabilities() {
        called = true;
      }
    })
  });

  assert.equal(called, true);
  assert.equal(result.applied, true);
});

test(`protected child bootstraps apply seccomp after capability sanitization and before config load`, () => {
  for (const bootstrapFile of [
    path.join(__dirname, `..`, `bootstrap`, `bootstrap-director.js`),
    path.join(__dirname, `..`, `bootstrap`, `bootstrap-transport.js`),
    path.join(__dirname, `..`, `bootstrap`, `bootstrap-isolated-runtime.js`)
  ]) {
    const source = fs.readFileSync(bootstrapFile, `utf8`);
    const sanitizeIndex = source.indexOf(`ensureBootstrapCapabilitiesSanitized`);
    const seccompIndex = source.indexOf(`applyConfiguredNoSpawnFilter`);
    const configIndex = source.indexOf(`default.user.config`);

    assert.notEqual(sanitizeIndex, -1, `${bootstrapFile} should sanitize capabilities`);
    assert.notEqual(seccompIndex, -1, `${bootstrapFile} should apply seccomp`);
    assert.notEqual(configIndex, -1, `${bootstrapFile} should load config`);
    assert.equal(sanitizeIndex < seccompIndex, true, `${bootstrapFile} should apply seccomp after capability sanitization`);
    assert.equal(seccompIndex < configIndex, true, `${bootstrapFile} should apply seccomp before config load`);
  }
});

test(`native seccomp filter blocks spawn, execFile, and fork when addon is available`, async (t) => {
  if (process.platform !== `linux`) {
    t.skip(`seccomp runtime probe is Linux-only`);
    return;
  }

  const addon = loadNativeSeccompAddon({ allowUnavailable: true });
  if (!addon) {
    t.skip(`native seccomp addon is not available in this environment`);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-seccomp-probe-`));
  const forkTargetPath = path.join(tempDir, `fork-target.js`);
  const probePath = path.join(tempDir, `probe.js`);

  try {
    fs.writeFileSync(forkTargetPath, [
      `'use strict';`,
      `process.exit(0);`
    ].join(`\n`));

    fs.writeFileSync(probePath, [
      `'use strict';`,
      `require(require.resolve('module-alias/register', { paths: [process.cwd()] }));`,
      `const cp = require('node:child_process');`,
      `const { applyNoSpawnFilter } = require('@/utils/process/seccomp');`,
      `const forkTargetPath = process.argv[2];`,
      `function resultFromError(error) {`,
      `  return { code: String(error?.code ?? error?.errno ?? error?.message ?? 'unknown') };`,
      `}`,
      `async function probeFork(targetPath) {`,
      `  return await new Promise((resolve) => {`,
      `    try {`,
      `      const child = cp.fork(targetPath, [], { stdio: 'pipe' });`,
      `      child.once('error', (error) => resolve(resultFromError(error)));`,
      `      child.once('spawn', () => {`,
      `        try { child.kill('SIGKILL'); } catch {}`,
      `        resolve({ code: 'SPAWNED_UNEXPECTEDLY' });`,
      `      });`,
      `    } catch (error) {`,
      `      resolve(resultFromError(error));`,
      `    }`,
      `  });`,
      `}`,
      `(async () => {`,
      `  applyNoSpawnFilter({ mode: 'enforce', processLabel: 'probe' });`,
      `  const spawnResult = cp.spawnSync('/usr/bin/env', ['true']);`,
      `  let execFileCode = 'NO_ERROR';`,
      `  try {`,
      `    cp.execFileSync('/usr/bin/env', ['true'], { stdio: 'ignore' });`,
      `  } catch (error) {`,
      `    execFileCode = String(error?.code ?? error?.errno ?? error?.message ?? 'unknown');`,
      `  }`,
      `  const forkResult = await probeFork(forkTargetPath);`,
      `  process.stdout.write(JSON.stringify({`,
      `    spawn: String(spawnResult?.error?.code ?? spawnResult?.error?.errno ?? 'NO_ERROR'),`,
      `    execFile: execFileCode,`,
      `    fork: forkResult.code`,
      `  }));`,
      `})().catch((error) => {`,
      `  console.error(error);`,
      `  process.exit(1);`,
      `});`
    ].join(`\n`));

    const result = spawnSync(process.execPath, [probePath, forkTargetPath], {
      cwd: path.join(__dirname, `..`),
      env: { ...process.env },
      encoding: `utf8`
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.spawn, `EPERM`);
    assert.equal(parsed.execFile, `EPERM`);
    assert.equal(parsed.fork, `EPERM`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`native seccomp filter still allows worker thread creation when addon is available`, async (t) => {
  if (process.platform !== `linux`) {
    t.skip(`seccomp runtime probe is Linux-only`);
    return;
  }

  const addon = loadNativeSeccompAddon({ allowUnavailable: true });
  if (!addon) {
    t.skip(`native seccomp addon is not available in this environment`);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-seccomp-worker-probe-`));
  const probePath = path.join(tempDir, `probe-worker.js`);

  try {
    fs.writeFileSync(probePath, [
      `'use strict';`,
      `require(require.resolve('module-alias/register', { paths: [process.cwd()] }));`,
      `const { Worker } = require('node:worker_threads');`,
      `const { applyNoSpawnFilter } = require('@/utils/process/seccomp');`,
      `applyNoSpawnFilter({ mode: 'enforce', processLabel: 'probe-worker' });`,
      `const worker = new Worker("const { parentPort } = require('node:worker_threads'); parentPort.postMessage('ok');", { eval: true });`,
      `worker.once('message', (value) => {`,
      `  process.stdout.write(String(value));`,
      `  worker.terminate().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });`,
      `});`,
      `worker.once('error', (error) => {`,
      `  console.error(error);`,
      `  process.exit(1);`,
      `});`
    ].join(`\n`));

    const result = spawnSync(process.execPath, [probePath], {
      cwd: path.join(__dirname, `..`),
      env: { ...process.env },
      encoding: `utf8`
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `ok`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
