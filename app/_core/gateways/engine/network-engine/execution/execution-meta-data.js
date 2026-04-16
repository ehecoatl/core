// _core/gateways/engine/network-engine/execution/execution-meta-data.js


'use strict';


/**
 * @typedef {Object} ControllerExecutionMeta
 * @property {number} coldWaitMs
 * @property {number} controllerMs
 */

/** Per-request metadata used for latency analysis, grouping, and stage diagnostics. */
class ExecutionMetaData {
  requestId;
  correlationId;
  startedAt;
  finishedAt;
  duration;

  currentStageIndex;
  currentStageName;

  session;
  cached;
  controller;

  bodyReadMs;
  responseWriteMs;
  latencyProfile;
  latencyClass;
  latencyThresholds;

  /** @type {ControllerExecutionMeta | null} */
  controllerMeta;

  constructor() {
    this.requestId = null;
    this.correlationId = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.duration = null;

    this.currentStageIndex = null;
    this.currentStageName = null;

    this.session = false;
    this.cached = false;
    this.controller = false;

    this.bodyReadMs = null;
    this.responseWriteMs = null;
    this.latencyProfile = null;
    this.latencyClass = null;
    this.latencyThresholds = null;

    this.controllerMeta = null;

    Object.preventExtensions(this);
  }
}

module.exports = ExecutionMetaData;
Object.freeze(module.exports);
