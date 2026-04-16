// _core/gateways/manager/queue-broker/queue-broker-adapter.js


'use strict';


/** Contract singleton for queue creation, task pooling, and queue teardown adapter methods. */
class QueueBrokerAdapter {
  /**
   * @type {(
   * params: { queueLabel: string, maxConcurrent?: number, waitTimeoutMs?: number, maxWaiting?: number, origin?: string, ttl?: number },
   * releaseCallback: (task: any) => void
   * ) => Promise<number | false | void>}
   */
  appendToQueueAdapter;
  /** @type {(params: { queueLabel: string, taskId?: number }) => boolean} */
  removeFromQueueAdapter;
  /** @type {(params: { origin: string }) => { success: boolean, removed: number, origin?: string }} */
  removeTasksByOriginAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new QueueBrokerAdapter();
Object.preventExtensions(module.exports);
