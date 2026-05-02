'use strict';

const crypto = require(`node:crypto`);
const fs = require(`node:fs`);
const path = require(`node:path`);

const DEFAULT_CGROUP_FS_ROOT = `/sys/fs/cgroup`;
const DEFAULT_MANAGED_ROOT_NAME = `ehecoatl-managed`;
const DEFAULT_REGISTRY_FILE = `/var/lib/ehecoatl/registry/managed-cgroups.json`;
const CPU_PERIOD_US = 100_000;
const REQUIRED_CONTROLLERS = Object.freeze([`cpu`, `memory`, `pids`]);

let registryQueue = Promise.resolve();

function getDefaultManagedCgroupOptions() {
  return Object.freeze({
    cgroupFsRoot: DEFAULT_CGROUP_FS_ROOT,
    managedRootName: DEFAULT_MANAGED_ROOT_NAME,
    registryFile: DEFAULT_REGISTRY_FILE
  });
}

async function ensureManagedCgroup(payload = {}, options = {}) {
  const normalized = normalizeEnsurePayload(payload);
  const resolved = resolveManagedCgroupPaths(payload, options);
  await ensureManagedRoot(resolved);

  const cgroupId = createManagedCgroupId(normalized.label, resolved.managedRootName);
  const cgroupPath = assertPathInside(resolved.managedRootPath, path.join(resolved.managedRootPath, cgroupId));
  await fs.promises.mkdir(cgroupPath, { recursive: false });
  await writeIfPresent(path.join(cgroupPath, `memory.max`), String(normalized.memoryMaxBytes), payload);
  await writeIfPresent(path.join(cgroupPath, `cpu.max`), `${normalized.cpuQuotaUs} ${CPU_PERIOD_US}`, payload);
  await writeIfPresent(path.join(cgroupPath, `memory.oom.group`), `1`, payload);

  const entry = {
    id: cgroupId,
    label: normalized.label,
    pid: null,
    state: `created`,
    cgroupPath,
    memoryMaxBytes: normalized.memoryMaxBytes,
    cpuMaxPercent: normalized.cpuMaxPercent,
    cpuMax: `${normalized.cpuQuotaUs} ${CPU_PERIOD_US}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await updateRegistry(resolved.registryFile, (registry) => {
    registry.entries = registry.entries.filter((item) => item.id !== cgroupId);
    registry.entries.push(entry);
    return registry;
  });

  return {
    id: cgroupId,
    cgroupPath,
    registryFile: resolved.registryFile,
    memoryMaxBytes: normalized.memoryMaxBytes,
    cpuMaxPercent: normalized.cpuMaxPercent,
    cpuMax: `${normalized.cpuQuotaUs} ${CPU_PERIOD_US}`
  };
}

async function registerManagedCgroupPid(payload = {}, options = {}) {
  const id = normalizeCgroupId(payload.id);
  const pid = normalizePositiveInteger(payload.pid, `pid`);
  const label = normalizeLabel(payload.label ?? `unknown`);
  const resolved = resolveManagedCgroupPaths(payload, options);
  const cgroupPath = assertPathInside(resolved.managedRootPath, path.join(resolved.managedRootPath, id));

  await fs.promises.writeFile(path.join(cgroupPath, `cgroup.procs`), String(pid));

  await updateRegistry(resolved.registryFile, (registry) => {
    const entry = registry.entries.find((item) => item.id === id);
    if (!entry) return registry;
    entry.pid = pid;
    entry.label = label;
    entry.state = `active`;
    entry.updatedAt = new Date().toISOString();
    return registry;
  });

  return { id, pid, label, registered: true };
}

async function releaseManagedCgroup(payload = {}, options = {}) {
  const id = normalizeCgroupId(payload.id);
  const resolved = resolveManagedCgroupPaths(payload, options);

  await updateRegistry(resolved.registryFile, (registry) => {
    const entry = registry.entries.find((item) => item.id === id);
    if (!entry) return registry;
    entry.state = `released`;
    entry.releasedAt = new Date().toISOString();
    entry.updatedAt = entry.releasedAt;
    return registry;
  });

  return { id, released: true };
}

async function cleanupManagedCgroups(payload = {}, options = {}) {
  const resolved = resolveManagedCgroupPaths(payload, options);
  await fs.promises.mkdir(path.dirname(resolved.registryFile), { recursive: true });
  const removed = [];

  await updateRegistry(resolved.registryFile, async (registry) => {
    const nextEntries = [];
    for (const entry of registry.entries) {
      const cgroupPath = assertPathInside(resolved.managedRootPath, entry.cgroupPath ?? ``);
      const active = await cgroupHasLiveProcesses(cgroupPath, entry.pid);
      if (active) {
        nextEntries.push(entry);
        continue;
      }
      await removeManagedCgroupPath(cgroupPath);
      removed.push({ id: entry.id, cgroupPath });
    }
    registry.entries = nextEntries;
    return registry;
  });

  await removeUnregisteredEmptyCgroups(resolved.managedRootPath, resolved.managedRootName, removed);
  return { removed, count: removed.length };
}

async function ensureManagedRoot({
  serviceCgroupPath
}) {
  await enableControllers(serviceCgroupPath);
}

async function enableControllers(cgroupPath) {
  const controllersPath = path.join(cgroupPath, `cgroup.controllers`);
  const subtreePath = path.join(cgroupPath, `cgroup.subtree_control`);
  const content = await fs.promises.readFile(controllersPath, `utf8`).catch((error) => {
    if (error?.code === `ENOENT`) return ``;
    throw error;
  });
  const available = new Set(content.trim().split(/\s+/).filter(Boolean));
  const enabled = await fs.promises.readFile(subtreePath, `utf8`).catch(() => ``);
  const enabledSet = new Set(enabled.trim().split(/\s+/).map((item) => item.replace(/^[+-]/, ``)).filter(Boolean));

  for (const controller of REQUIRED_CONTROLLERS) {
    if (!available.has(controller) || enabledSet.has(controller)) continue;
    await fs.promises.writeFile(subtreePath, `+${controller}`).then(() => {
      enabledSet.add(controller);
    }).catch((error) => {
      if ([`EBUSY`, `EINVAL`, `ENOTSUP`, `EOPNOTSUPP`].includes(error?.code)) return;
      throw error;
    });
  }
}

async function writeIfPresent(filePath, value, payload = {}) {
  await fs.promises.writeFile(filePath, value).catch((error) => {
    if (error?.code === `ENOENT` && payload.allowMissingCgroupFiles === true) {
      return fs.promises.writeFile(filePath, value);
    }
    if (error?.code === `ENOENT`) {
      const missing = new Error(`Required cgroup file is not available: ${filePath}`);
      missing.code = `CGROUP_CONTROLLER_UNAVAILABLE`;
      throw missing;
    }
    throw error;
  });
}

async function cgroupHasLiveProcesses(cgroupPath, pid = null) {
  const procs = await readCgroupProcs(cgroupPath);
  for (const procPid of procs) {
    if (await processExists(procPid)) return true;
  }
  if (pid != null && await processExists(pid)) return true;
  return false;
}

async function readCgroupProcs(cgroupPath) {
  const content = await fs.promises.readFile(path.join(cgroupPath, `cgroup.procs`), `utf8`).catch((error) => {
    if (error?.code === `ENOENT`) return ``;
    throw error;
  });
  return content.trim().split(/\s+/).filter(Boolean).map((value) => Number.parseInt(value, 10)).filter(Number.isInteger);
}

async function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === `ESRCH`) return false;
    return true;
  }
}

async function removeManagedCgroupPath(cgroupPath) {
  await fs.promises.rm(cgroupPath, { recursive: true, force: true }).catch((error) => {
    if ([`EBUSY`, `ENOTEMPTY`].includes(error?.code)) return;
    throw error;
  });
}

async function removeUnregisteredEmptyCgroups(managedRootPath, managedRootName, removed) {
  const entries = await fs.promises.readdir(managedRootPath, { withFileTypes: true }).catch((error) => {
    if (error?.code === `ENOENT`) return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(`${managedRootName}_`)) continue;
    const cgroupPath = assertPathInside(managedRootPath, path.join(managedRootPath, entry.name));
    if (await cgroupHasLiveProcesses(cgroupPath)) continue;
    await removeManagedCgroupPath(cgroupPath);
    removed.push({ id: entry.name, cgroupPath, unregistered: true });
  }
}

function resolveManagedCgroupPaths(payload = {}, options = {}) {
  const cgroupFsRoot = path.resolve(String(
    options.cgroupFsRoot
    ?? payload.cgroupFsRoot
    ?? DEFAULT_CGROUP_FS_ROOT
  ));
  const registryFile = path.resolve(String(
    options.registryFile
    ?? payload.registryFile
    ?? DEFAULT_REGISTRY_FILE
  ));
  const managedRootName = sanitizeSegment(
    options.managedRootName
    ?? payload.managedRootName
    ?? DEFAULT_MANAGED_ROOT_NAME,
    DEFAULT_MANAGED_ROOT_NAME
  );
  const serviceCgroup = normalizeServiceCgroupPath(
    resolveDelegatedServiceCgroup({
      serviceCgroup: options.serviceCgroup ?? payload.serviceCgroup ?? readCurrentServiceCgroup(),
      delegateSubgroup: options.delegateSubgroup ?? payload.delegateSubgroup ?? null
    })
  );
  const serviceCgroupPath = assertPathInside(cgroupFsRoot, path.join(cgroupFsRoot, serviceCgroup.replace(/^\/+/, ``)));
  const managedRootPath = serviceCgroupPath;

  return {
    cgroupFsRoot,
    registryFile,
    managedRootName,
    serviceCgroup,
    serviceCgroupPath,
    managedRootPath
  };
}

function readCurrentServiceCgroup() {
  const content = fs.readFileSync(`/proc/self/cgroup`, `utf8`);
  const line = content.split(/\r?\n/).find((entry) => entry.startsWith(`0::`));
  const cgroup = line ? line.slice(3).trim() : ``;
  if (!cgroup || cgroup === `/`) {
    throw new Error(`Unable to resolve current cgroup v2 service path`);
  }
  return cgroup;
}

function normalizeEnsurePayload(payload = {}) {
  const cgroups = payload.cgroups ?? payload.resources?.cgroups ?? payload.resources ?? {};
  const label = normalizeLabel(payload.label ?? `unknown`);
  const memoryMaxMb = normalizePositiveInteger(cgroups.memoryMaxMb ?? 192, `memoryMaxMb`);
  const cpuMaxPercent = normalizePositiveNumber(cgroups.cpuMaxPercent ?? 50, `cpuMaxPercent`);
  return {
    label,
    memoryMaxBytes: memoryMaxMb * 1024 * 1024,
    cpuMaxPercent,
    cpuQuotaUs: Math.max(1_000, Math.round((cpuMaxPercent / 100) * CPU_PERIOD_US))
  };
}

function normalizeServiceCgroupPath(value) {
  const normalized = String(value ?? ``).trim();
  if (!normalized || normalized === `/`) {
    throw new Error(`Managed cgroups require a non-root service cgroup path`);
  }
  return normalized.startsWith(`/`) ? normalized : `/${normalized}`;
}

function resolveDelegatedServiceCgroup({
  serviceCgroup,
  delegateSubgroup = null
}) {
  const normalized = normalizeServiceCgroupPath(serviceCgroup);
  const subgroup = sanitizeSegment(delegateSubgroup, ``);
  if (!subgroup) return normalized;
  const suffix = `/${subgroup}`;
  if (normalized.endsWith(suffix)) {
    return normalized.slice(0, -suffix.length) || `/`;
  }
  return normalized;
}

function normalizeCgroupId(value) {
  const normalized = sanitizeSegment(value, ``);
  if (!normalized) {
    const error = new Error(`Managed cgroup id is required`);
    error.code = `INVALID_MANAGED_CGROUP_ID`;
    throw error;
  }
  return normalized;
}

function normalizeLabel(value) {
  return sanitizeSegment(value, `process`).slice(0, 80);
}

function sanitizeSegment(value, fallback) {
  const normalized = String(value ?? ``)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, `_`)
    .replace(/^_+|_+$/g, ``);
  return normalized || fallback;
}

function normalizePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const error = new Error(`${label} must be a positive integer`);
    error.code = `INVALID_MANAGED_CGROUP_RESOURCE`;
    throw error;
  }
  return parsed;
}

function normalizePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${label} must be a positive number`);
    error.code = `INVALID_MANAGED_CGROUP_RESOURCE`;
    throw error;
  }
  return parsed;
}

function createManagedCgroupId(label, managedRootName = DEFAULT_MANAGED_ROOT_NAME) {
  return [
    sanitizeSegment(managedRootName, DEFAULT_MANAGED_ROOT_NAME),
    `cg`,
    sanitizeSegment(label, `process`).slice(0, 48),
    Date.now().toString(36),
    crypto.randomBytes(4).toString(`hex`)
  ].join(`_`);
}

function assertPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === `` || (!relative.startsWith(`..`) && !path.isAbsolute(relative))) {
    return target;
  }
  const error = new Error(`Managed cgroup path is outside the allowed root: ${targetPath}`);
  error.code = `INVALID_MANAGED_CGROUP_PATH`;
  throw error;
}

async function readRegistry(registryFile) {
  const content = await fs.promises.readFile(registryFile, `utf8`).catch((error) => {
    if (error?.code === `ENOENT`) return null;
    throw error;
  });
  if (!content) {
    return { version: 1, entries: [] };
  }
  const parsed = JSON.parse(content);
  return {
    version: 1,
    ...parsed,
    entries: Array.isArray(parsed.entries) ? parsed.entries : []
  };
}

async function writeRegistry(registryFile, registry) {
  await fs.promises.mkdir(path.dirname(registryFile), { recursive: true });
  const tempPath = `${registryFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, `utf8`);
  await fs.promises.rename(tempPath, registryFile);
}

async function updateRegistry(registryFile, updateFn) {
  const next = registryQueue.then(async () => {
    const registry = await readRegistry(registryFile);
    const updated = await updateFn(registry);
    await writeRegistry(registryFile, updated);
    return updated;
  });
  registryQueue = next.catch(() => {});
  return await next;
}

module.exports = {
  CPU_PERIOD_US,
  DEFAULT_CGROUP_FS_ROOT,
  DEFAULT_MANAGED_ROOT_NAME,
  DEFAULT_REGISTRY_FILE,
  cleanupManagedCgroups,
  ensureManagedCgroup,
  getDefaultManagedCgroupOptions,
  registerManagedCgroupPid,
  releaseManagedCgroup,
  resolveManagedCgroupPaths
};

Object.freeze(module.exports);
