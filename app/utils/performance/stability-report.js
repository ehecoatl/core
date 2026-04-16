// utils/performance/stability-report.js


'use strict';

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentileFromSorted(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  const ratio = clampNumber(p, 0, 100) / 100;
  const index = Math.floor((sortedValues.length - 1) * ratio);
  return sortedValues[index];
}

function summarizeDurations(durations = []) {
  if (!Array.isArray(durations) || durations.length === 0) {
    return {
      count: 0,
      avgMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0
    };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    avgMs: round(total / sorted.length),
    minMs: round(sorted[0]),
    maxMs: round(sorted[sorted.length - 1]),
    p50Ms: round(percentileFromSorted(sorted, 50)),
    p95Ms: round(percentileFromSorted(sorted, 95)),
    p99Ms: round(percentileFromSorted(sorted, 99)),
  };
}

function classifyByThresholds(value, thresholds = {}) {
  const warnAt = Number(thresholds.warnAt ?? Number.POSITIVE_INFINITY);
  const failAt = Number(thresholds.failAt ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(value)) return `warn`;
  if (value >= failAt) return `fail`;
  if (value >= warnAt) return `warn`;
  return `pass`;
}

function evaluateSampleSeries(samples = [], thresholds = {}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      status: `warn`,
      samples: 0,
      avg: 0,
      max: 0
    };
  }

  const valid = samples.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return {
      status: `warn`,
      samples: 0,
      avg: 0,
      max: 0
    };
  }
  const max = Math.max(...valid);
  const avg = valid.reduce((acc, value) => acc + value, 0) / valid.length;
  const statusByMax = classifyByThresholds(max, thresholds);
  const statusByAvg = classifyByThresholds(avg, thresholds);
  const status = statusByMax === `fail` || statusByAvg === `fail`
    ? `fail`
    : (statusByMax === `warn` || statusByAvg === `warn` ? `warn` : `pass`);

  return {
    status,
    samples: valid.length,
    avg: round(avg),
    max: round(max)
  };
}

function mergeStatuses(values = []) {
  if (values.includes(`fail`)) return `fail`;
  if (values.includes(`warn`)) return `warn`;
  return `pass`;
}

module.exports = {
  summarizeDurations,
  evaluateSampleSeries,
  mergeStatuses,
  classifyByThresholds,
  round
};

Object.freeze(module.exports);
