// _core/boot/heartbeat-health.js


'use strict';


const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

let prev = performance.eventLoopUtilization();
let heartbeatCallback;
let heartbeatMeta = Object.create(null);

const interval = setInterval(() => {
  const elu = performance.eventLoopUtilization(prev);
  prev = elu;

  if (typeof heartbeatCallback === 'function') {
    try {
      heartbeatCallback({
        pid: process.pid,
        processLabel: heartbeatMeta.processLabel ?? process.title ?? `node`,
        timestamp: Date.now(),
        uptimeSec: process.uptime(),
        elu: elu.utilization, // 0..1
        lagMeanMs: h.mean / 1e6,
        lagP99Ms: h.percentile(99) / 1e6,
        lagMaxMs: h.max / 1e6,
      });
    } catch {
      // ignore callback failures to keep heartbeat scheduler alive
    }
  }

  h.reset();
}, 5000);

interval.unref();

function setHeartbeatCallback(callback, meta = {}) {
  heartbeatCallback = callback;
  heartbeatMeta = { ...meta };
}

module.exports.setHeartbeatCallback = setHeartbeatCallback;
