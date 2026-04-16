// _core/gateways/engine/request-pipeline/request-pipeline.js


'use strict';


const StageContext = require(`./stage-context`);
const ExecutionContext = require(`g@/engine/network-engine/execution/execution-context`);
const GatewayCore = require(`g@/gateway-core`);

/** Engine gateway that executes ordered HTTP request stages with hook-aware flow control. */
class RequestPipeline extends GatewayCore {
  maxInputBytes;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./request-pipeline-adapter')} */
  adapter = null;

  /** Captures pipeline config, executor access, and lazy adapter metadata for stage execution. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.requestPipeline);
    this.config = kernelContext.config.requestPipeline;
    this.maxInputBytes = this.config.maxInputBytes;
    this.plugin = kernelContext.plugin;
    super.loadAdapter();

    Object.freeze(this);
  }

  /**
   * Runs an ordered stage sequence and stops on abort, break, or pipeline failure.
   * @param {Array<(stageContext: import('./stage-context')) => Promise<boolean> | boolean>} stageSequence
   * @param {ExecutionContext} executionContext
   */
  async #runPipeline(stageSequence, executionContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const {
      START: STAGE_START,
      END: STAGE_END,
      BREAK: STAGE_BREAK,
      ERROR: STAGE_ERROR
    } = hooks.ENGINE.PIPELINE.STAGE;
    const stageContext = new StageContext(executionContext);
    try {
      for (let i = 0, l = stageSequence.length; i < l; i++) {
        if (executionContext.isAborted()) break;
        const stage = stageSequence[i];
        executionContext.meta.currentStageIndex = i;
        executionContext.meta.currentStageName = stage?.name || `stage_${i}`;

        await plugin.run(STAGE_START, executionContext, STAGE_ERROR);
        const continuePipeline = await stage(stageContext);
        await plugin.run(STAGE_END, executionContext, STAGE_ERROR);

        if (!continuePipeline) {
          await plugin.run(STAGE_BREAK, executionContext, STAGE_ERROR);
          break;
        }
      }
    } catch (e) {
      await plugin.run(hooks.ENGINE.PIPELINE.ERROR, executionContext);
      executionContext.responseData.status = 500;
      executionContext.responseData.body = `Internal Server 'Pipeline' Error`;
      executionContext.abort();
    } finally {
      executionContext.meta.currentStageIndex = null;
      executionContext.meta.currentStageName = null;
      await executionContext.callFinishCallbacks();
    }
  }

  /**
   * Executes the configured HTTP stage sequence with pipeline lifecycle hooks.
   * @param {ExecutionContext} executionContext
   */
  async runHttpPipeline(executionContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const { START, END, BREAK, ERROR } = hooks.ENGINE.PIPELINE;
    super.loadAdapter();
    if (!executionContext.isAborted() && !executionContext.tenantRoute.isRedirect()) {
      await plugin.run(START, executionContext, ERROR);
      await this.#runPipeline(this.adapter.httpStageSequence, executionContext);
      await plugin.run(END, executionContext, ERROR);
    } else {
      await plugin.run(BREAK, executionContext, ERROR);
    }
  }

}

module.exports = RequestPipeline;
Object.freeze(module.exports);
