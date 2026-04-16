// test/perf-stability-utils.test.js

'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const {
  summarizeDurations,
  evaluateSampleSeries,
  mergeStatuses,
  classifyByThresholds
} = require(`@/utils/performance/stability-report`);

test(`summarizeDurations returns percentile metrics`, () => {
  const summary = summarizeDurations([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(summary.count, 10);
  assert.equal(summary.avgMs, 55);
  assert.equal(summary.minMs, 10);
  assert.equal(summary.maxMs, 100);
  assert.equal(summary.p50Ms, 50);
  assert.equal(summary.p95Ms, 90);
  assert.equal(summary.p99Ms, 90);
});

test(`evaluateSampleSeries escalates status based on thresholds`, () => {
  const pass = evaluateSampleSeries([10, 20, 30], { warnAt: 40, failAt: 60 });
  const warn = evaluateSampleSeries([10, 45, 30], { warnAt: 40, failAt: 60 });
  const fail = evaluateSampleSeries([10, 70, 30], { warnAt: 40, failAt: 60 });

  assert.equal(pass.status, `pass`);
  assert.equal(warn.status, `warn`);
  assert.equal(fail.status, `fail`);
});

test(`mergeStatuses prefers fail over warn and pass`, () => {
  assert.equal(mergeStatuses([`pass`, `pass`]), `pass`);
  assert.equal(mergeStatuses([`pass`, `warn`]), `warn`);
  assert.equal(mergeStatuses([`pass`, `warn`, `fail`]), `fail`);
});

test(`classifyByThresholds classifies by warn and fail bounds`, () => {
  assert.equal(classifyByThresholds(10, { warnAt: 20, failAt: 30 }), `pass`);
  assert.equal(classifyByThresholds(20, { warnAt: 20, failAt: 30 }), `warn`);
  assert.equal(classifyByThresholds(31, { warnAt: 20, failAt: 30 }), `fail`);
});
