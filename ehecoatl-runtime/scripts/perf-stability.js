#!/usr/bin/env node

'use strict';

require(`module-alias/register`);

const fs = require(`node:fs/promises`);
const path = require(`node:path`);
const process = require(`node:process`);
const { performance, monitorEventLoopDelay, PerformanceObserver } = require(`node:perf_hooks`);
const {
  summarizeDurations,
  evaluateSampleSeries,
  mergeStatuses,
  round
} = require(`@/utils/performance/stability-report`);

const DEFAULT_PATHS = Object.freeze({
  staticAsset: `/htm/index.htm`,
  cacheHit: `/htm/cached.htm`,
  action: `/hello`
});

const DEFAULT_PHASES = Object.freeze([
  { name: `warmup`, durationSec: 15, concurrency: 6 },
  { name: `steady`, durationSec: 45, concurrency: 16 },
  { name: `spike`, durationSec: 20, concurrency: 32 },
  { name: `soak`, durationSec: 180, concurrency: 20 },
  { name: `cooldown`, durationSec: 15, concurrency: 6 }
]);

const QUICK_PHASES = Object.freeze([
  { name: `warmup`, durationSec: 5, concurrency: 4 },
  { name: `steady`, durationSec: 12, concurrency: 10 },
  { name: `spike`, durationSec: 8, concurrency: 20 },
  { name: `soak`, durationSec: 20, concurrency: 10 },
  { name: `cooldown`, durationSec: 5, concurrency: 4 }
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  latencyP95Ms: { warnAt: 250, failAt: 600 },
  latencyP99Ms: { warnAt: 600, failAt: 1200 },
  errorRatePct: { warnAt: 1, failAt: 3 },
  eventLoopLagP99Ms: { warnAt: 80, failAt: 150 },
  eventLoopLagMaxMs: { warnAt: 200, failAt: 500 },
  eluPct: { warnAt: 85, failAt: 95 },
  cpuPct: { warnAt: 80, failAt: 95 },
  rssMiB: { warnAt: 450, failAt: 700 },
  heapUsedMiB: { warnAt: 250, failAt: 420 },
  gcOverheadPct: { warnAt: 12, failAt: 20 }
});

const BASELINE_MIX = Object.freeze([
  { profile: `staticAsset`, weight: 25 },
  { profile: `cacheHit`, weight: 25 },
  { profile: `action`, weight: 50 },
]);

const PHASE_MIX_OVERRIDES = Object.freeze({
  spike: [
    { profile: `staticAsset`, weight: 15 },
    { profile: `cacheHit`, weight: 15 },
    { profile: `action`, weight: 70 },
  ]
});

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith(`--`)) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith(`--`)) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === `boolean`) return value;
  const text = String(value).trim().toLowerCase();
  if ([`1`, `true`, `yes`, `on`].includes(text)) return true;
  if ([`0`, `false`, `no`, `off`].includes(text)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoForFile(date = new Date()) {
  const pad = (num) => String(num).padStart(2, `0`);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function pickWeighted(mix) {
  const total = mix.reduce((acc, item) => acc + Math.max(0, Number(item.weight ?? 0)), 0);
  if (total <= 0) return mix[0]?.profile ?? `action`;
  let ticket = Math.random() * total;
  for (const item of mix) {
    ticket -= Math.max(0, Number(item.weight ?? 0));
    if (ticket <= 0) return item.profile;
  }
  return mix[mix.length - 1]?.profile ?? `action`;
}

function nowIso() {
  return new Date().toISOString();
}

function toMiB(bytes) {
  return round(bytes / (1024 * 1024));
}

async function run() {
  const args = parseArgs();
  const quick = parseBoolean(args.quick, false);
  const phases = quick ? QUICK_PHASES : DEFAULT_PHASES;
  const baseUrl = String(args.baseUrl ?? process.env.PERF_BASE_URL ?? `https://127.0.0.1`);
  const hostHeader = String(args.host ?? process.env.PERF_HOST ?? `www.fakedomain.com`);
  const outDir = path.resolve(args.outDir ?? path.join(process.cwd(), `..`, `report`, `performance`));
  const topic = String(args.topic ?? `stability-load-test`);
  const disableTlsVerify = parseBoolean(args.insecureTls, true);
  const requestTimeoutMs = parseNumber(args.requestTimeoutMs, 2000);
  const sampleIntervalMs = parseNumber(args.sampleIntervalMs, 1000);
  const includeProfiles = String(args.profiles ?? `staticAsset,cacheHit,action`)
    .split(`,`)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (disableTlsVerify && baseUrl.startsWith(`https://`)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = `0`;
  }

  const scenarioPaths = {};
  for (const profile of includeProfiles) {
    scenarioPaths[profile] = DEFAULT_PATHS[profile] ?? DEFAULT_PATHS.action;
  }

  const loadState = {
    startedAt: nowIso(),
    phases: [],
    durationsAllMs: [],
    durationsByProfile: {},
    statusCodes: {},
    errorsByType: {},
    totalRequests: 0,
    totalErrors: 0,
    totalSuccess: 0
  };
  for (const profile of includeProfiles) {
    loadState.durationsByProfile[profile] = [];
  }

  const runtimeSamples = [];
  const gcStats = {
    totalCount: 0,
    totalDurationMs: 0,
    byKind: {}
  };

  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
  let prevCpu = process.cpuUsage();
  let prevTs = performance.now();
  let prevElu = performance.eventLoopUtilization();

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const kind = String(entry.kind ?? `unknown`);
      gcStats.totalCount += 1;
      gcStats.totalDurationMs += entry.duration;
      gcStats.byKind[kind] ??= { count: 0, durationMs: 0 };
      gcStats.byKind[kind].count += 1;
      gcStats.byKind[kind].durationMs += entry.duration;
    }
  });
  observer.observe({ entryTypes: [`gc`] });

  const sampleTimer = setInterval(() => {
    const now = performance.now();
    const cpuNow = process.cpuUsage();
    const cpuDiffMicros = (cpuNow.user - prevCpu.user) + (cpuNow.system - prevCpu.system);
    const wallMs = Math.max(1, now - prevTs);
    const cpuPct = (cpuDiffMicros / 1000) / wallMs * 100;
    prevCpu = cpuNow;
    prevTs = now;

    const elu = performance.eventLoopUtilization(prevElu);
    prevElu = elu;
    const memory = process.memoryUsage();

    runtimeSamples.push({
      at: nowIso(),
      rssMiB: toMiB(memory.rss),
      heapUsedMiB: toMiB(memory.heapUsed),
      heapTotalMiB: toMiB(memory.heapTotal),
      externalMiB: toMiB(memory.external),
      arrayBuffersMiB: toMiB(memory.arrayBuffers ?? 0),
      cpuPct: round(cpuPct),
      eluPct: round((elu.utilization ?? 0) * 100),
      eventLoopLagP99Ms: round(eventLoopDelay.percentile(99) / 1e6),
      eventLoopLagMaxMs: round(eventLoopDelay.max / 1e6)
    });
    eventLoopDelay.reset();
  }, sampleIntervalMs);
  sampleTimer.unref?.();

  const phaseSummaries = [];

  async function issueRequest(phaseName, workerId) {
    const mix = PHASE_MIX_OVERRIDES[phaseName] ?? BASELINE_MIX;
    const profile = pickWeighted(mix.filter((entry) => includeProfiles.includes(entry.profile)));
    const requestPath = scenarioPaths[profile] ?? DEFAULT_PATHS.action;
    const url = new URL(requestPath, baseUrl).toString();
    const started = performance.now();

    let response = null;
    try {
      response = await fetch(url, {
        method: `GET`,
        headers: { Host: hostHeader },
        redirect: `manual`,
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      await response.arrayBuffer().catch(() => { });
    } catch (error) {
      const elapsed = performance.now() - started;
      loadState.totalRequests += 1;
      loadState.totalErrors += 1;
      loadState.errorsByType[error?.name ?? `RequestError`] = (loadState.errorsByType[error?.name ?? `RequestError`] ?? 0) + 1;
      loadState.durationsAllMs.push(elapsed);
      loadState.durationsByProfile[profile].push(elapsed);
      return {
        profile,
        elapsedMs: elapsed,
        isError: true
      };
    }

    const elapsed = performance.now() - started;
    loadState.totalRequests += 1;
    loadState.durationsAllMs.push(elapsed);
    loadState.durationsByProfile[profile].push(elapsed);
    const statusCode = Number(response?.status ?? 0);
    loadState.statusCodes[statusCode] = (loadState.statusCodes[statusCode] ?? 0) + 1;

    if (statusCode >= 200 && statusCode < 400) {
      loadState.totalSuccess += 1;
      return {
        profile,
        elapsedMs: elapsed,
        isError: false
      };
    }

    loadState.totalErrors += 1;
    loadState.errorsByType[`HTTP_${statusCode}`] = (loadState.errorsByType[`HTTP_${statusCode}`] ?? 0) + 1;
    return {
      profile,
      elapsedMs: elapsed,
      isError: true
    };
  }

  async function runPhase(phaseConfig) {
    const phaseState = {
      name: phaseConfig.name,
      startedAt: nowIso(),
      durationSec: phaseConfig.durationSec,
      concurrency: phaseConfig.concurrency,
      requests: 0,
      errors: 0,
      durationsMs: [],
      byProfile: {}
    };
    for (const profile of includeProfiles) {
      phaseState.byProfile[profile] = [];
    }

    const phaseStarted = performance.now();
    const phaseEndsAt = phaseStarted + (phaseConfig.durationSec * 1000);
    const workerCount = Math.max(1, Number(phaseConfig.concurrency ?? 1));

    await Promise.all(Array.from({ length: workerCount }, async (_, workerId) => {
      while (performance.now() < phaseEndsAt) {
        const result = await issueRequest(phaseConfig.name, workerId);
        if (!result) continue;
        phaseState.requests += 1;
        phaseState.durationsMs.push(result.elapsedMs);
        phaseState.byProfile[result.profile].push(result.elapsedMs);
        if (result.isError) phaseState.errors += 1;
      }
    }));

    phaseState.finishedAt = nowIso();
    phaseState.wallClockMs = round(performance.now() - phaseStarted);
    const elapsedSec = Math.max(1e-6, phaseState.wallClockMs / 1000);
    phaseState.reqPerSec = round(phaseState.requests / elapsedSec);
    phaseState.errorRatePct = phaseState.requests > 0
      ? round((phaseState.errors / phaseState.requests) * 100)
      : 0;
    phaseState.latency = summarizeDurations(phaseState.durationsMs);
    delete phaseState.durationsMs;

    return phaseState;
  }

  try {
    for (const phase of phases) {
      const summary = await runPhase(phase);
      phaseSummaries.push(summary);
      loadState.phases.push({
        ...summary,
      });
      if (phase.name === `warmup`) {
        await sleep(200);
      }
    }
  } finally {
    clearInterval(sampleTimer);
    observer.disconnect();
    eventLoopDelay.disable();
  }

  const totalDurationSec = phaseSummaries.reduce((acc, item) => acc + item.durationSec, 0);
  const latencyAll = summarizeDurations(loadState.durationsAllMs);
  const latencyByProfile = {};
  for (const profile of includeProfiles) {
    latencyByProfile[profile] = summarizeDurations(loadState.durationsByProfile[profile]);
  }

  const errorRatePct = loadState.totalRequests > 0
    ? round((loadState.totalErrors / loadState.totalRequests) * 100)
    : 0;
  const reqPerSec = totalDurationSec > 0
    ? round(loadState.totalRequests / totalDurationSec)
    : 0;

  const rssSeries = runtimeSamples.map((sample) => sample.rssMiB);
  const heapUsedSeries = runtimeSamples.map((sample) => sample.heapUsedMiB);
  const cpuSeries = runtimeSamples.map((sample) => sample.cpuPct);
  const eluSeries = runtimeSamples.map((sample) => sample.eluPct);
  const lagP99Series = runtimeSamples.map((sample) => sample.eventLoopLagP99Ms);
  const lagMaxSeries = runtimeSamples.map((sample) => sample.eventLoopLagMaxMs);
  const gcOverheadPct = totalDurationSec > 0
    ? round((gcStats.totalDurationMs / (totalDurationSec * 1000)) * 100)
    : 0;

  const checks = {
    latencyP95: {
      value: latencyAll.p95Ms,
      ...evaluateSampleSeries([latencyAll.p95Ms], DEFAULT_THRESHOLDS.latencyP95Ms),
      threshold: DEFAULT_THRESHOLDS.latencyP95Ms
    },
    latencyP99: {
      value: latencyAll.p99Ms,
      ...evaluateSampleSeries([latencyAll.p99Ms], DEFAULT_THRESHOLDS.latencyP99Ms),
      threshold: DEFAULT_THRESHOLDS.latencyP99Ms
    },
    errorRate: {
      value: errorRatePct,
      ...evaluateSampleSeries([errorRatePct], DEFAULT_THRESHOLDS.errorRatePct),
      threshold: DEFAULT_THRESHOLDS.errorRatePct
    },
    eventLoopLagP99: {
      value: runtimeSamples.length ? Math.max(...lagP99Series) : 0,
      ...evaluateSampleSeries(lagP99Series, DEFAULT_THRESHOLDS.eventLoopLagP99Ms),
      threshold: DEFAULT_THRESHOLDS.eventLoopLagP99Ms
    },
    eventLoopLagMax: {
      value: runtimeSamples.length ? Math.max(...lagMaxSeries) : 0,
      ...evaluateSampleSeries(lagMaxSeries, DEFAULT_THRESHOLDS.eventLoopLagMaxMs),
      threshold: DEFAULT_THRESHOLDS.eventLoopLagMaxMs
    },
    eluPct: {
      value: runtimeSamples.length ? Math.max(...eluSeries) : 0,
      ...evaluateSampleSeries(eluSeries, DEFAULT_THRESHOLDS.eluPct),
      threshold: DEFAULT_THRESHOLDS.eluPct
    },
    cpuPct: {
      value: runtimeSamples.length ? Math.max(...cpuSeries) : 0,
      ...evaluateSampleSeries(cpuSeries, DEFAULT_THRESHOLDS.cpuPct),
      threshold: DEFAULT_THRESHOLDS.cpuPct
    },
    rssMiB: {
      value: runtimeSamples.length ? Math.max(...rssSeries) : 0,
      ...evaluateSampleSeries(rssSeries, DEFAULT_THRESHOLDS.rssMiB),
      threshold: DEFAULT_THRESHOLDS.rssMiB
    },
    heapUsedMiB: {
      value: runtimeSamples.length ? Math.max(...heapUsedSeries) : 0,
      ...evaluateSampleSeries(heapUsedSeries, DEFAULT_THRESHOLDS.heapUsedMiB),
      threshold: DEFAULT_THRESHOLDS.heapUsedMiB
    },
    gcOverheadPct: {
      value: gcOverheadPct,
      ...evaluateSampleSeries([gcOverheadPct], DEFAULT_THRESHOLDS.gcOverheadPct),
      threshold: DEFAULT_THRESHOLDS.gcOverheadPct
    }
  };

  const overallStatus = mergeStatuses(Object.values(checks).map((entry) => entry.status));
  const generatedAt = nowIso();
  const output = {
    reportType: `stability-load-performance`,
    generatedAt,
    scope: {
      repository: `ehecoatl`,
      area: `runtime load and stability`,
      coverage: [
        `warmup phase`,
        `steady phase`,
        `spike phase`,
        `soak phase`,
        `cooldown phase`,
        `runtime resource sampling`,
        `latency and error profiling`,
        `gc/event-loop pressure analysis`
      ]
    },
    summary: {
      overallAssessment: overallStatus === `pass` ? `good` : (overallStatus === `warn` ? `needs-work` : `blocked`),
      highLevelVerdict: `Multi-phase load execution finished with ${loadState.totalRequests} requests, ${errorRatePct}% errors, p95=${latencyAll.p95Ms}ms, p99=${latencyAll.p99Ms}ms, and ${overallStatus.toUpperCase()} threshold status.`
    },
    scenario: {
      baseUrl,
      hostHeader,
      insecureTls: disableTlsVerify,
      requestTimeoutMs,
      sampleIntervalMs,
      phases,
      routes: scenarioPaths
    },
    measurements: {
      totals: {
        durationSec: totalDurationSec,
        requests: loadState.totalRequests,
        success: loadState.totalSuccess,
        errors: loadState.totalErrors,
        reqPerSec,
        errorRatePct
      },
      latency: {
        overall: latencyAll,
        byProfile: latencyByProfile
      },
      statusCodes: loadState.statusCodes,
      errorsByType: loadState.errorsByType,
      runtime: {
        samples: runtimeSamples,
        maxima: {
          rssMiB: runtimeSamples.length ? round(Math.max(...rssSeries)) : 0,
          heapUsedMiB: runtimeSamples.length ? round(Math.max(...heapUsedSeries)) : 0,
          cpuPct: runtimeSamples.length ? round(Math.max(...cpuSeries)) : 0,
          eluPct: runtimeSamples.length ? round(Math.max(...eluSeries)) : 0,
          eventLoopLagP99Ms: runtimeSamples.length ? round(Math.max(...lagP99Series)) : 0,
          eventLoopLagMaxMs: runtimeSamples.length ? round(Math.max(...lagMaxSeries)) : 0
        },
        gc: {
          totalCount: gcStats.totalCount,
          totalDurationMs: round(gcStats.totalDurationMs),
          overheadPct: gcOverheadPct,
          byKind: gcStats.byKind
        }
      },
      phaseResults: phaseSummaries
    },
    requiredChecks: checks,
    nextAction: {
      recommended: overallStatus === `pass`
        ? `Keep current baseline and compare against future regressions using this report file as reference.`
        : `Inspect failed or warning checks, then tune runtime configuration or isolate bottlenecks by profile and rerun.`,
      commandHint: `npm run perf:stability -- --baseUrl ${baseUrl} --host ${hostHeader}`
    }
  };

  await fs.mkdir(outDir, { recursive: true });
  const filename = `${isoForFile(new Date())}.${topic}.json`;
  const fullPath = path.join(outDir, filename);
  await fs.writeFile(fullPath, `${JSON.stringify(output, null, 2)}\n`, `utf8`);

  process.stdout.write(`Performance report written to: ${fullPath}\n`);
  process.stdout.write(`Overall status: ${overallStatus.toUpperCase()} | Requests: ${loadState.totalRequests} | p95: ${latencyAll.p95Ms}ms | Error rate: ${errorRatePct}%\n`);
}

run().catch((error) => {
  process.stderr.write(`[perf-stability] failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
