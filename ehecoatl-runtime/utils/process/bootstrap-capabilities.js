'use strict';

const fs = require(`node:fs`);
const { spawn } = require(`node:child_process`);

const CAP_SETGID = 6n;
const CAP_SETUID = 7n;
const CAP_NET_ADMIN = 12n;
const CAP_STATUS_FIELDS = [`CapInh`, `CapPrm`, `CapEff`, `CapBnd`, `CapAmb`];

function readCapabilitySnapshot() {
  const status = fs.readFileSync(`/proc/self/status`, `utf8`);
  const capabilityMasks = CAP_STATUS_FIELDS.map((fieldName) => {
    const match = status.match(new RegExp(`^${fieldName}:\\s*([0-9a-fA-F]+)$`, `m`));
    if (!match) return 0n;
    return BigInt(`0x${match[1]}`);
  });

  return {
    any() {
      return capabilityMasks.some((capabilitySet) => capabilitySet !== 0n);
    },
    has(capabilityBit) {
      const mask = 1n << capabilityBit;
      return capabilityMasks.some((capabilitySet) => (capabilitySet & mask) !== 0n);
    }
  };
}

function resolveSetprivPath() {
  const candidates = [`/usr/bin/setpriv`, `/bin/setpriv`];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function reexecWithSanitizedCapabilities(setprivPath, keepCapabilities = []) {
  return new Promise((resolve, reject) => {
    const capabilityArgs = Array.isArray(keepCapabilities) && keepCapabilities.length > 0
      ? [
        `--inh-caps=-all,${keepCapabilities.map((capability) => `+${capability}`).join(`,`)}`,
        `--ambient-caps=-all,${keepCapabilities.map((capability) => `+${capability}`).join(`,`)}`,
        `--bounding-set=-all,${keepCapabilities.map((capability) => `+${capability}`).join(`,`)}`
      ]
      : [
        `--inh-caps=-all`,
        `--ambient-caps=-all`,
        `--bounding-set=-all`
      ];

    const sanitizedChild = spawn(
      setprivPath,
      [
        ...capabilityArgs,
        `--pdeathsig`,
        `keep`,
        process.execPath,
        process.argv[1],
        ...process.argv.slice(2)
      ],
      {
        cwd: process.cwd(),
        stdio: `inherit`,
        env: { ...process.env }
      }
    );

    const forwardSignal = (signal) => {
      if (sanitizedChild.killed) return;
      try {
        sanitizedChild.kill(signal);
      } catch {
        // Best-effort forwarding only.
      }
    };

    [`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGQUIT`].forEach((signal) => {
      process.on(signal, () => forwardSignal(signal));
    });

    sanitizedChild.once(`error`, reject);
    sanitizedChild.once(`exit`, (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exit(Number.isInteger(code) ? code : 1);
    });
  });
}

async function ensureBootstrapCapabilitiesSanitized({
  keepCapabilities = [],
  dropIfAnyCapabilities = false
}) {
  if (process.platform !== `linux`) return;
  if (typeof process.getuid === `function` && process.getuid() !== 0) return;

  const capabilitySnapshot = readCapabilitySnapshot();
  const shouldSanitize = dropIfAnyCapabilities
    ? capabilitySnapshot.any()
    : capabilitySnapshot.has(CAP_NET_ADMIN);
  if (!shouldSanitize) return;

  if (keepCapabilities.includes(`setuid`) && !capabilitySnapshot.has(CAP_SETUID)) {
    throw new Error(`Bootstrap capability sanitization requested setuid retention, but CAP_SETUID is not available.`);
  }

  if (keepCapabilities.includes(`setgid`) && !capabilitySnapshot.has(CAP_SETGID)) {
    throw new Error(`Bootstrap capability sanitization requested setgid retention, but CAP_SETGID is not available.`);
  }

  const setprivPath = resolveSetprivPath();
  if (!setprivPath) {
    throw new Error(`Bootstrap capability sanitization requires setpriv when CAP_NET_ADMIN is inherited.`);
  }

  await reexecWithSanitizedCapabilities(setprivPath, keepCapabilities);
}

module.exports = {
  ensureBootstrapCapabilitiesSanitized
};

Object.freeze(module.exports);
