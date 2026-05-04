'use strict';

const fs = require(`node:fs`);
const path = require(`node:path`);
const { spawnSync } = require(`node:child_process`);

const addonDir = path.join(__dirname, `..`, `utils`, `process`, `seccomp`);
const buildDir = path.join(addonDir, `build`);
const requiredBuild = process.env.EHECOATL_SECCOMP_BUILD_REQUIRED === `1`;

function logWarning(message) {
  console.warn(`[SECCOMP BUILD WARNING] ${message}`);
}

function failBuild(message) {
  if (!requiredBuild) {
    logWarning(message);
    return;
  }

  console.error(`[SECCOMP BUILD ERROR] ${message}`);
  process.exit(1);
}

function main() {
  if (process.platform !== `linux`) {
    failBuild(`Skipping seccomp addon build on unsupported platform ${process.platform}.`);
    return;
  }

  let nodeGypBin = null;
  try {
    nodeGypBin = require.resolve(`node-gyp/bin/node-gyp.js`);
  } catch (error) {
    failBuild(`node-gyp is unavailable, so the seccomp addon was not built.`);
    return;
  }

  fs.rmSync(buildDir, { recursive: true, force: true });

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
    failBuild(`Seccomp addon build failed. Runtime boot will enforce or warn according to runtime.security.seccomp.mode.`);
    return;
  }

  console.log(`[SECCOMP BUILD] Native seccomp addon built successfully.`);
}

main();
