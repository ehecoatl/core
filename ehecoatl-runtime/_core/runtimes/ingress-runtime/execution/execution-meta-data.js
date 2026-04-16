// _core/runtimes/ingress-runtime/execution/execution-meta-data.js


'use strict';


/**
 * @typedef {Object} ActionExecutionMeta
 * @property {number} coldWaitMs
 * @property {number} actionMs
 */

/** Per-request metadata used for latency analysis, grouping, and middleware diagnostics. */
class ExecutionMetaData {
  requestId;
  correlationId;
  startedAt;
  finishedAt;
  duration;

  currentMiddlewareIndex;
  currentMiddlewareName;

  session;
  cached;
  action;
  forcedAppId;

  bodyReadMs;
  responseWriteMs;
  latencyProfile;
  latencyClass;
  latencyThresholds;

  /** @type {ActionExecutionMeta | null} */
  actionMeta;

  constructor() {
    this.requestId = null;
    this.correlationId = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.duration = null;

    this.currentMiddlewareIndex = null;
    this.currentMiddlewareName = null;

    this.session = false;
    this.cached = false;
    this.action = false;
    this.forcedAppId = null;

    this.bodyReadMs = null;
    this.responseWriteMs = null;
    this.latencyProfile = null;
    this.latencyClass = null;
    this.latencyThresholds = null;

    this.actionMeta = null;

    Object.preventExtensions(this);
  }
}

module.exports = ExecutionMetaData;
Object.freeze(module.exports);
