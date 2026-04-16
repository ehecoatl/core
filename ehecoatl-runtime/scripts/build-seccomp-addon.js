'use strict';

const path = require(`node:path`);
const { spawnSync } = require(`node:child_process`);

const addonDir = path.join(__dirname, `..`, `utils`, `process`, `seccomp`);

function logWarning(message) {
  console.warn(`[SECCOMP BUILD WARNING] ${message}`);
}

function main() {
  if (process.platform !== `linux`) {
    logWarning(`Skipping seccomp addon build on unsupported platform ${process.platform}.`);
    return;
  }

  let nodeGypBin = null;
  try {
    nodeGypBin = require.resolve(`node-gyp/bin/node-gyp.js`);
  } catch (error) {
    logWarning(`node-gyp is unavailable, so the seccomp addon was not built.`);
    return;
  }

  const result = spawnSync(
    process.execPath,
    [nodeGypBin, `rebuild`],
    {
      cwd: addonDir,
      stdio: `inherit`,
      env: { ...process.env }
    }
  );

  if (result.status !== 0) {
    logWarning(`Seccomp addon build failed. Runtime boot will enforce or warn according to runtime.security.seccomp.mode.`);
    return;
  }

  console.log(`[SECCOMP BUILD] Native seccomp addon built successfully.`);
}

main();
