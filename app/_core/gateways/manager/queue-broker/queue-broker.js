// _core/gateways/manager/queue-broker/queue-broker.js


'use strict';

const GatewayCore = require(`g@/gateway-core`);

/** Manager gateway that brokers queued delayed work through the configured queue adapter. */
class QueueBroker extends GatewayCore {
  /** @type {typeof import('@/config/default.config')['queueBroker']} */
  config;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./queue-broker-adapter')} */
  adapter = null;

  /** Captures queue config, plugin hooks, and lazy adapter metadata for manager-side queueing. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.queueBroker);
    this.config = kernelContext.config.queueBroker;
    this.plugin = kernelContext.plugin;

    this.hooks = this.plugin.hooks.MANAGER.QUEUE_BROKER;
    this.run = this.run.bind(this);
    super.loadAdapter();

    Object.freeze(this);
  }

  /** Dispatches a queue-related hook with the queue broker instance as hook context. */
  run(hookId, errHook = this.hooks.ERROR ?? null) {
    return this.plugin.run(hookId, this, errHook);
  }

  /** Enqueues a delayed task in the active queue adapter. */
  async appendToQueue({ queueLabel, maxConcurrent, waitTimeoutMs, maxWaiting, origin, ttl }, answerCallback) {
    super.loadAdapter();
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
    super.loadAdapter();
    return { success: await this.adapter.removeFromQueueAdapter({ queueLabel, taskId }) };
  }

  /** Removes queued or running tasks owned by one process origin. */
  async removeTasksByOrigin({ origin }) {
    super.loadAdapter();
    return this.adapter.removeTasksByOriginAdapter({ origin });
  }

}

module.exports = QueueBroker;
Object.freeze(module.exports);
