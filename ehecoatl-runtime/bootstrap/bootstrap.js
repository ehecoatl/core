// bootstrap/bootstrap.js


'use strict';

const path = require(`node:path`);
const { fork } = require(`node:child_process`);
const { spawn } = require(`node:child_process`);
const fs = require(`node:fs`);
const { getProcessIdentity } = require(`../contracts/utils.js`);
const {
  resolveUserId,
  resolveGroupId
} = require(`../utils/process/system-identity.js`);
const {
  attachPrivilegedBridge,
  clearStaleFirewallStateBeforeBoot
} = require(`../scripts/privileged-host.js`);

let mainBootstrapChild = null;

function resolveSetprivPath() {
  const candidates = [`/usr/bin/setpriv`, `/bin/setpriv`];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function exitAfterDelay(code = 0) {
  setTimeout(() => process.exit(code), 500);
}

function forwardSignal(signal) {
  if (mainBootstrapChild?.killed) return;
  try {
    mainBootstrapChild?.kill(signal);
  } catch (error) {
    // Best-effort forwarding only.
  }
}

function attachSignalForwarding() {
  [`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGQUIT`].forEach((signal) => {
    process.on(signal, () => forwardSignal(signal));
  });
}

function getMainBootstrapIdentity() {
  const mainIdentity = getProcessIdentity(`supervisionScope`, `main`) ?? {};
  const user = mainIdentity.user ?? `ehecoatl`;
  const group = mainIdentity.group ?? user;

  return Object.freeze({
    user,
    group,
    uid: resolveUserId(user),
    gid: resolveGroupId(group, user)
  });
}

function launchMainBootstrap() {
  const entryPath = path.join(__dirname, `bootstrap-main.js`);
  const identity = getMainBootstrapIdentity();
  const setprivPath = resolveSetprivPath();

  return new Promise((resolve, reject) => {
    if (setprivPath) {
      mainBootstrapChild = spawn(setprivPath, [
        `--securebits`, `+no_setuid_fixup`,
        `--inh-caps=-all,+setuid,+setgid`,
        `--ambient-caps=-all,+setuid,+setgid`,
        `--bounding-set=-all,+setuid,+setgid`,
        process.execPath,
        entryPath
      ], {
        cwd: path.join(__dirname, `..`),
        env: {
          ...process.env,
          PROCESS_USER: identity.user,
          PROCESS_GROUP: identity.group,
          PROCESS_SECOND_GROUP: ``,
          PROCESS_THIRD_GROUP: ``
        },
        stdio: [`inherit`, `inherit`, `inherit`, `ipc`],
        shell: false
      });
    } else {
      mainBootstrapChild = fork(entryPath, [], {
        cwd: path.join(__dirname, `..`),
        env: { ...process.env },
        stdio: `inherit`,
        serialization: `advanced`,
        uid: identity.uid,
        gid: identity.gid
      });
    }
    attachPrivilegedBridge(mainBootstrapChild);

    let settled = false;
    const settle = (handler) => (value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    mainBootstrapChild.once(`spawn`, settle(resolve));
    mainBootstrapChild.once(`error`, settle(reject));
    mainBootstrapChild.once(`exit`, (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`bootstrap-main exited before startup completed (code=${code}, signal=${signal})`));
        return;
      }
      const exitCode = Number.isInteger(code) ? code : 0;
      process.exitCode = exitCode;
      exitAfterDelay(exitCode);
    });
  });
}

module.exports = async function bootstrap() {
  attachSignalForwarding();
  await clearStaleFirewallStateBeforeBoot();
  return launchMainBootstrap();
};

Object.freeze(module.exports);
