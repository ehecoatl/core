'use strict';

const fs = require(`node:fs`);
const path = require(`node:path`);

const DEFAULT_CGROUP_FS_ROOT = `/sys/fs/cgroup`;
const MANAGED_CGROUP_PREFIX = `ehecoatl-managed_`;

function attachCurrentProcessToManagedCgroup({
  env = process.env,
  pid = process.pid,
  fsAdapter = fs
} = {}) {
  const cgroupPath = String(env.EHECOATL_CGROUP_PATH ?? ``).trim();
  if (!cgroupPath) {
    return { attached: false, skipped: true, reason: `missing_cgroup_path` };
  }

  const normalizedPath = normalizeManagedCgroupPath(cgroupPath);
  fsAdapter.writeFileSync(path.join(normalizedPath, `cgroup.procs`), String(pid));
  return {
    attached: true,
    cgroupPath: normalizedPath,
    cgroupId: String(env.EHECOATL_CGROUP_ID ?? ``).trim() || null,
    pid
  };
}

function attachManagedCgroupOrExit(options = {}) {
  try {
    return attachCurrentProcessToManagedCgroup(options);
  } catch (error) {
    const externalAttach = waitForExternalAttach({
      cgroupPath: String(process.env.EHECOATL_CGROUP_PATH ?? ``).trim(),
      pid: process.pid,
      timeoutMs: Number(process.env.EHECOATL_CGROUP_ATTACH_WAIT_MS ?? 1000)
    });
    if (externalAttach.attached) {
      return externalAttach;
    }
    if (String(process.env.EHECOATL_CGROUP_REQUIRED ?? ``) !== `1`) {
      return { attached: false, skipped: true, reason: `attach_failed_optional`, error };
    }
    console.error(`[MANAGED CGROUP] failed to attach process ${process.pid} before privilege drop`);
    console.error(error);
    process.exit(78);
  }
}

function waitForExternalAttach({
  cgroupPath,
  pid,
  timeoutMs
}) {
  const normalizedPath = cgroupPath ? normalizeManagedCgroupPath(cgroupPath) : null;
  if (!normalizedPath) {
    return { attached: false, skipped: true, reason: `missing_cgroup_path` };
  }
  const expectedName = path.basename(normalizedPath);
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000);

  while (Date.now() <= deadline) {
    const current = readCurrentCgroupPath(pid);
    if (current && current.split(`/`).includes(expectedName)) {
      return {
        attached: true,
        cgroupPath: normalizedPath,
        cgroupId: String(process.env.EHECOATL_CGROUP_ID ?? ``).trim() || null,
        pid,
        method: `privileged`
      };
    }
    sleep(10);
  }

  return { attached: false, skipped: false, reason: `external_attach_timeout` };
}

function readCurrentCgroupPath(pid) {
  try {
    const content = fs.readFileSync(`/proc/${pid}/cgroup`, `utf8`);
    const line = content.split(/\r?\n/).find((entry) => entry.startsWith(`0::`));
    return line ? line.slice(3).trim() : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function normalizeManagedCgroupPath(cgroupPath) {
  const normalized = path.resolve(cgroupPath);
  const cgroupRoot = path.resolve(DEFAULT_CGROUP_FS_ROOT);
  const relative = path.relative(cgroupRoot, normalized);
  if (
    relative.startsWith(`..`)
    || path.isAbsolute(relative)
    || !path.basename(normalized).startsWith(MANAGED_CGROUP_PREFIX)
  ) {
    const error = new Error(`Refusing to attach to unmanaged cgroup path: ${cgroupPath}`);
    error.code = `INVALID_MANAGED_CGROUP_PATH`;
    throw error;
  }
  return normalized;
}

module.exports = {
  attachCurrentProcessToManagedCgroup,
  attachManagedCgroupOrExit,
  waitForExternalAttach,
  normalizeManagedCgroupPath
};

Object.freeze(module.exports);
