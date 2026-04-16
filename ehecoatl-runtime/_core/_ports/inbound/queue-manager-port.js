// _core/_ports/outbound/managers/queue-manager-port.js


'use strict';


/** Contract singleton for queue creation, task pooling, and queue teardown port methods. */
class QueueManagerPort {
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

module.exports = new QueueManagerPort();
Object.preventExtensions(module.exports);
