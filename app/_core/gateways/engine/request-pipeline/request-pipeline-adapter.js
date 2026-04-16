// _core/gateways/engine/request-pipeline/request-pipeline-adapter.js


'use strict';


/** Contract singleton for request pipeline stage sequences and teardown behavior. */
class RequestPipelineAdapter {
  /** @type {Array<(stageContext: import('./stage-context')) => Promise<boolean> | boolean>} */
  httpStageSequence;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new RequestPipelineAdapter();
Object.preventExtensions(module.exports);
