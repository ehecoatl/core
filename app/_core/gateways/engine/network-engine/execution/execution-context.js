// _core/gateways/engine/network-engine/execution/execution-context.js


'use strict';


const TenantRoute = require(`g@/engine/network-engine/execution/tenant-route`);
const ResponseData = require(`g@/engine/network-engine/execution/response-data`);
const RequestData = require(`g@/engine/network-engine/execution/request-data`);
const ExecutionMetaData = require(`g@/engine/network-engine/execution/execution-meta-data`);
const NetworkEngine = require(`g@/engine/network-engine/network-engine`);
const { classifyRequestLatency } = require(`@/utils/observability/request-latency-classifier`);

/** Per-request runtime state object used across engine, pipeline, and response execution. */
class ExecutionContext {
  id;

  #idle;
  #aborted;

  plugin;
  hooks;
  networkEngine;
  managerHelper;
  sessionHelper;
  services;

  /** @type {RequestData} */
  requestData;
  /** @type {ResponseData} */
  responseData;
  /** @type {ExecutionMetaData} */
  meta;

  sessionData;
  finishCallbacks;
  metaFinalized;

  /** @type {TenantRoute} */
  tenantRoute;

  /**
   * 
   * @param {NetworkEngine} networkEngine 
   * @param {*} param0 
   */
  /** Initializes the per-request execution state shared across engine, pipeline, and response flow. */
  constructor(networkEngine, {
    ws, message, isBinary,
    req, res, ip
  }) {
    this.#idle = false;
    this.#aborted = false;

    this.ip = ip;
    this.req = req;
    this.res = res;

    this.plugin = networkEngine.plugin;

    const { RESPONSE, REQUEST } = this.plugin.hooks.ENGINE;
    this.hooks = { RESPONSE, REQUEST };

    this.networkEngine = networkEngine;
    this.managerHelper = networkEngine.createManagerHelper(this);
    this.sessionHelper = networkEngine.createSessionHelper(this);
    this.services = networkEngine.services;

    this.responseData = new ResponseData();
    this.sessionData = {};
    this.finishCallbacks = [];
    this.metaFinalized = false;

    this.meta = new ExecutionMetaData();

    this.run = this.run.bind(this);
    this.run(this.hooks.REQUEST.START, this.hooks.REQUEST.ERROR);

    Object.preventExtensions(this);
  }

  /** Reports whether request execution has been aborted. */
  isAborted() { return this.#aborted; }
  /** Marks the execution context as aborted and emits the request break hook. */
  abort() {
    this.#aborted = true;
    this.run(this.hooks.REQUEST.BREAK, this.hooks.REQUEST.ERROR);
  }
  /** Reports whether the execution context is currently marked idle. */
  isIdle() { return this.#idle; }
  /** Marks the execution context as idle for detached or long-lived flows. */
  idle() { this.#idle = true; }

  /** Runs one hook with the execution context itself as hook payload. */
  run(hookId, errHook = null) {
    return this.plugin.run(hookId, this, errHook);
  }

  /** Normalizes and attaches request data for the current inbound transport payload. */
  async setupRequestData(params) {
    this.requestData = new RequestData(params);
  }

  /** Delegates HTTP pipeline execution to the owning network engine. */
  runHttpPipeline() {
    return this.networkEngine.requestPipeline.runHttpPipeline(this);
  }

  /** Emits the request end hook for the current execution context. */
  end() {
    this.finalizeMeta();
    return this.run(this.hooks.REQUEST.END, this.hooks.REQUEST.ERROR);
  }

  /**
   * FINISH CALLS
   */

  /** Registers a callback to be executed when the request lifecycle finishes. */
  addFinishCallback(callback) {
    if (typeof callback === `function`)
      this.finishCallbacks.push(callback);
  }

  /** Executes all registered finish callbacks without freezing request metadata early. */
  async callFinishCallbacks() {
    for (const c of this.finishCallbacks) {
      if (typeof c === `function`) await c();
    }
  }

  /** Finalizes immutable request metadata once the full request lifecycle has completed. */
  finalizeMeta() {
    if (this.metaFinalized) return;

    this.meta.finishedAt = Date.now();
    this.meta.duration = this.meta.finishedAt - this.meta.startedAt;
    const latencyClassification = classifyRequestLatency({
      durationMs: this.meta.duration,
      tenantRoute: this.tenantRoute,
      meta: this.meta,
      config: this.networkEngine?.requestPipeline?.config?.latencyClassification
    });
    if (latencyClassification) {
      this.meta.latencyProfile = latencyClassification.profile;
      this.meta.latencyClass = latencyClassification.class;
      this.meta.latencyThresholds = latencyClassification.thresholds;
    }
    if (this.meta.controllerMeta) {
      Object.freeze(this.meta.controllerMeta);
    }
    Object.freeze(this.meta);
    this.metaFinalized = true;
  }
}

module.exports = ExecutionContext;
Object.freeze(module.exports);
