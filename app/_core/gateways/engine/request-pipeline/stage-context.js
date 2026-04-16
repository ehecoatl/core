// _core/gateways/engine/request-pipeline/stage-context.js


'use strict';


const ExecutionContext = require(`g@/engine/network-engine/execution/execution-context`);
const ExecutionMetaData = require(`g@/engine/network-engine/execution/execution-meta-data`);

/** Mutable stage helper passed through pipeline stages to coordinate request execution flow. */
class StageContext {
  services;
  tenantRoute;
  requestData;
  sessionData;
  requestPipelineConfig;
  /** @type {ExecutionMetaData} */
  meta;
  #responseData;

  #executionContext;

  /**
   * Exposes a stage-friendly facade over execution context state and response mutators.
   * @param {ExecutionContext} ec
   */
  constructor(ec) {
    this.services = ec.services;
    this.tenantRoute = ec.tenantRoute;
    this.requestData = ec.requestData;
    this.sessionData = ec.sessionData;
    this.requestPipelineConfig = ec.networkEngine.requestPipeline.config;
    this.meta = ec.meta;

    this.#responseData = ec.responseData;
    this.#executionContext = ec;

    Object.freeze(this);
  }

  /** Delegates a manager RPC question through the execution context manager facade. */
  askManager(question, data) {
    return this.#executionContext.managerHelper.askManager(question, data);
  }

  /** Registers a completion callback on the underlying execution context. */
  addFinishCallback(callback) {
    this.#executionContext.addFinishCallback(callback);
  }

  /** SET */

  /** Writes the response body into the underlying response envelope. */
  setBody(body) { this.#responseData.body = body; }

  /** Writes the response status into the underlying response envelope. */
  setStatus(status) { this.#responseData.status = status; }

  /** Writes one response header into the underlying response envelope. */
  setHeader(key, value) { this.#responseData.headers[key] = value; }

  /** Writes one response cookie entry into the underlying response envelope. */
  setCookie(key, value) {
    if (!this.#responseData.cookie) this.#responseData.cookie = {};
    this.#responseData.cookie[key] = value;
  }

  /** GET */

  /** Reads the current response body from the underlying response envelope. */
  getBody() { return this.#responseData.body; }

  /** Reads the current response status from the underlying response envelope. */
  getStatus() { return this.#responseData.status; }

  /** Reads one response header from the underlying response envelope. */
  getHeader(key) { return this.#responseData.headers[key]; }

  /** Reads the current response header map from the underlying response envelope. */
  getHeaders() { return this.#responseData.headers; }

  /** Reads one response cookie entry from the underlying response envelope. */
  getCookie(key) { return this.#responseData.cookie?.[key]; }

  /** Reads the current response cookie map from the underlying response envelope. */
  getCookies() { return this.#responseData.cookie ?? null; }
}

module.exports = StageContext;
Object.freeze(module.exports);
