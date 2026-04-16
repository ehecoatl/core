// adapters/engine/request-pipeline/default-pipeline/index.js


'use strict';


const RequestPipelineAdapter = require(`g@/engine/request-pipeline/request-pipeline-adapter`);

RequestPipelineAdapter.httpStageSequence = [
  require(`./stages/local-file-stream-stage`),
  require(`./stages/mid-queue-stage`), //controller queue
  require(`./stages/mid-session-queue-stage`),
  require(`./stages/tenant-controller-stage`),
  require(`./stages/response-cache-materialization-stage`),
];

module.exports = RequestPipelineAdapter;
Object.freeze(RequestPipelineAdapter);
