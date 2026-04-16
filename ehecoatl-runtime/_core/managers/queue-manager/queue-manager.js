// _core/managers/queue-manager/queue-manager.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Manager use case that manages queued delayed work through the configured queue adapter. */
class QueueManager extends AdaptableUseCase {
  /** @type {typeof import('@/config/default.config').adapters.queueBroker} */
  config;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;

  /** Captures queue config, plugin hooks, and adapter metadata for director-side queueing. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.queueBroker);
    this.config = kernelContext.config.adapters.queueBroker;
    this.plugin = kernelContext.pluginOrchestrator;

    this.hooks = this.plugin.hooks.DIRECTOR.QUEUE_BROKER;
    this.run = this.run.bind(this);

    Object.freeze(this);
  }

  /** Dispatches a queue-related hook with the queue manager instance as hook context. */
  run(hookId, errHook = this.hooks.ERROR ?? null) {
    return this.plugin.run(hookId, this, errHook);
  }

  /** Enqueues a delayed task in the active queue adapter. */
  async appendToQueue({ queueLabel, maxConcurrent, waitTimeoutMs, maxWaiting, origin, ttl }, answerCallback) {
    await this.adapter.appendToQueueAdapter({
      queueLabel,
      maxConcurrent,
      waitTimeoutMs: waitTimeoutMs ?? ttl,
      maxWaiting,
      origin
    }, answerCallback);
    return false; // WAIT FOR EVENT, ANSWER CALLBACK WILL BE CALLED WHEN READY
  }

  /** Removes a running task from the active queue adapter by queue label and task id. */
  async removeFromQueue({ queueLabel, taskId }) {
    return { success: await this.adapter.removeFromQueueAdapter({ queueLabel, taskId }) };
  }

  /** Removes queued or running tasks owned by one process origin. */
  async removeTasksByOrigin({ origin }) {
    return this.adapter.removeTasksByOriginAdapter({ origin });
  }

}

module.exports = QueueManager;
Object.freeze(module.exports);
