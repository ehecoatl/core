// utils/observability/tenant-report-writer.js


'use strict';

const fs = require(`node:fs`);
const fsPromises = require(`node:fs/promises`);
const path = require(`node:path`);

const defaultOptions = Object.freeze({
  enabled: false,
  relativePath: path.join(`.ehecoatl`, `.log`, `report.json`),
  flushIntervalMs: 5000
});

const STATUS_CLASSES = Object.freeze([`2xx`, `3xx`, `4xx`, `5xx`, `other`]);

/**
 * Creates an async tenant-level request quality reporter with in-memory aggregation and periodic flush.
 * @param {{
 * enabled?: boolean,
 * relativePath?: string,
 * flushIntervalMs?: number
 * }} options
 */
function createTenantReportWriter(options = {}) {
  const config = {
    ...defaultOptions,
    ...(options ?? {})
  };
  config.relativePath = normalizeTenantReportRelativePath(config.relativePath);

  const stateByTenant = new Map();
  const writeTasks = new Map();
  let flushTimer = null;

  if (config.enabled === true) {
    const flushIntervalMs = Number(config.flushIntervalMs);
    if (Number.isFinite(flushIntervalMs) && flushIntervalMs > 0) {
      flushTimer = setInterval(() => {
        flushAll().catch(() => { });
      }, flushIntervalMs);
      flushTimer.unref?.();
    }
  }

  function observeRequest(executionContext) {
    if (config.enabled !== true) return;
    const tenantRoute = executionContext?.tenantRoute;
    const tenantHost = String(tenantRoute?.origin?.hostname ?? ``).trim();
    const tenantRoot = String(tenantRoute?.folders?.rootFolder ?? ``).trim();
    if (!tenantHost || !tenantRoot) return;

    const key = `${tenantHost}:${tenantRoot}`;
    const nowISO = new Date().toISOString();
    let tenantState = stateByTenant.get(key);
    if (!tenantState) {
      tenantState = createTenantState({ tenantHost, tenantRoot, nowISO });
      stateByTenant.set(key, tenantState);
    }

    const statusClass = classifyStatus(executionContext?.responseData?.status);
    const latencyProfile = String(executionContext?.meta?.latencyProfile ?? `default`);
    const latencyClass = String(executionContext?.meta?.latencyClass ?? `unknown`);
    const durationMs = Number(executionContext?.meta?.duration);

    tenantState.totals.requests += 1;
    tenantState.totals.byStatusClass[statusClass] += 1;
    tenantState.latency.byProfile[latencyProfile] = (tenantState.latency.byProfile[latencyProfile] ?? 0) + 1;
    tenantState.latency.byClass[latencyClass] = (tenantState.latency.byClass[latencyClass] ?? 0) + 1;

    if (Number.isFinite(durationMs) && durationMs >= 0) {
      tenantState.latency.duration.count += 1;
      tenantState.latency.duration.totalMs += durationMs;
      tenantState.latency.duration.avgMs = Math.round((tenantState.latency.duration.totalMs / tenantState.latency.duration.count) * 1000) / 1000;
      tenantState.latency.duration.maxMs = Math.max(tenantState.latency.duration.maxMs, durationMs);
      tenantState.latency.duration.minMs = Math.min(tenantState.latency.duration.minMs, durationMs);
    }

    tenantState.lastUpdatedAt = nowISO;
    tenantState.dirty = true;
  }

  async function flushAll() {
    if (config.enabled !== true) return;
    const flushTasks = [];
    for (const [key] of stateByTenant) {
      flushTasks.push(flushTenant(key));
    }
    await Promise.all(flushTasks);
  }

  async function close() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    await flushAll().catch(() => { });
    while (writeTasks.size > 0) {
      await Promise.all([...writeTasks.values()]).catch(() => { });
    }
  }

  async function flushTenant(tenantKey) {
    const tenantState = stateByTenant.get(tenantKey);
    if (!tenantState) return;

    const runningTask = writeTasks.get(tenantKey);
    if (runningTask) {
      tenantState.flushQueued = true;
      return runningTask;
    }
    if (!tenantState.dirty) return;

    const task = (async () => {
      tenantState.dirty = false;
      const payload = buildReportPayload(tenantState);
      const targetPath = path.join(tenantState.tenantRoot, config.relativePath);

      try {
        await writeJsonAtomic(targetPath, payload);
      } catch {
        tenantState.dirty = true;
      } finally {
        writeTasks.delete(tenantKey);
        if (tenantState.flushQueued || tenantState.dirty) {
          tenantState.flushQueued = false;
          await flushTenant(tenantKey);
        }
      }
    })();

    writeTasks.set(tenantKey, task);
    return task;
  }

  return Object.freeze({
    observeRequest,
    flushAll,
    close
  });
}

function normalizeTenantReportRelativePath(relativePath) {
  const fallback = path.posix.join(`.ehecoatl`, `.log`, `report.json`);
  const value = String(relativePath ?? ``).trim();
  if (!value) return fallback;

  const normalized = path.posix.normalize(value.replaceAll(`\\`, `/`));
  if (!normalized || normalized === `.` || normalized === `/`) return fallback;
  if (normalized.startsWith(`../`) || normalized === `..`) return fallback;

  const sanitized = normalized.replace(/^\/+/, ``);
  const parts = sanitized.split(`/`).filter(Boolean);
  if (parts.length === 0) return fallback;

  if (parts[0] !== `.ehecoatl` || parts[1] !== `.log`) {
    return path.posix.join(`.ehecoatl`, `.log`, path.posix.basename(sanitized));
  }

  return sanitized;
}

function createTenantState({ tenantHost, tenantRoot, nowISO }) {
  return {
    tenantHost,
    tenantRoot,
    windowStartedAt: nowISO,
    lastUpdatedAt: nowISO,
    totals: {
      requests: 0,
      byStatusClass: STATUS_CLASSES.reduce((acc, key) => {
        acc[key] = 0;
        return acc;
      }, {})
    },
    latency: {
      byProfile: {},
      byClass: {},
      duration: {
        count: 0,
        totalMs: 0,
        avgMs: 0,
        minMs: Number.POSITIVE_INFINITY,
        maxMs: 0
      }
    },
    quality: {
      compliance: null
    },
    dirty: false,
    flushQueued: false
  };
}

function buildReportPayload(tenantState) {
  const duration = tenantState.latency.duration;
  const minMs = duration.count > 0 ? duration.minMs : 0;
  const maxMs = duration.count > 0 ? duration.maxMs : 0;

  return {
    meta: {
      version: 1
    },
    tenantHost: tenantState.tenantHost,
    windowStartedAt: tenantState.windowStartedAt,
    lastUpdatedAt: tenantState.lastUpdatedAt,
    totals: {
      requests: tenantState.totals.requests,
      byStatusClass: tenantState.totals.byStatusClass
    },
    latency: {
      byProfile: tenantState.latency.byProfile,
      byClass: tenantState.latency.byClass,
      duration: {
        count: duration.count,
        totalMs: duration.totalMs,
        avgMs: duration.avgMs,
        minMs,
        maxMs
      }
    },
    quality: tenantState.quality
  };
}

function classifyStatus(status) {
  const numeric = Number(status);
  if (!Number.isInteger(numeric) || numeric <= 0) return `other`;
  const classKey = `${Math.floor(numeric / 100)}xx`;
  if (STATUS_CLASSES.includes(classKey)) return classKey;
  return `other`;
}

async function writeJsonAtomic(targetPath, payload) {
  const targetDir = path.dirname(targetPath);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  await fsPromises.mkdir(targetDir, { recursive: true });
  try {
    await fsPromises.writeFile(tempPath, serialized, `utf8`);
    await fsPromises.rename(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      await fsPromises.rm(tempPath, { force: true }).catch(() => { });
    }
  }
}

module.exports = Object.freeze({
  createTenantReportWriter
});
