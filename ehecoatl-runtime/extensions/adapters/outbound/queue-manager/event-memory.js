// adapters/manager/queue-manager/event-memory.js


'use strict';


const QueueManagerPort = require(`@/_core/_ports/outbound/queue-manager-port`);

/** @type {Record<string, Queue>} */
const activeQueue = {};

const defaultWaitingMax = 1_000;

const queuePool = [];
const queuePoolMax = 10;
const taskPool = [];
const taskPoolMax = defaultWaitingMax * 4;


QueueManagerPort.appendToQueueAdapter = async (
  { queueLabel, maxConcurrent, waitTimeoutMs, maxWaiting, origin = null },
  delayedAnswer
) => {
  maxConcurrent = maxConcurrent ?? 1;
  waitTimeoutMs = waitTimeoutMs ?? 1000;
  maxWaiting = maxWaiting ?? defaultWaitingMax;

  if (!(queueLabel in activeQueue)) {
    activeQueue[queueLabel] = getQueue(queueLabel, maxConcurrent, maxWaiting);
  }

  const queue = activeQueue[queueLabel];
  const taskId = await getTaskId(queue);

  if (taskId === false) {
    delayedAnswer({
      success: false,
      reason: `queue_full`,
      queueLabel,
      maxConcurrent,
      maxWaiting: queue.maxWaiting
    });
    return false;
  }

  queue.tasks[taskId] = getTask({
    waitTimeoutMs,
    queue,
    delayedAnswer,
    taskId,
    origin,
    first: queue.running === 0,
  });
  queue.waiting++;
  queue.tasks[taskId].waitTimeout = setTimeout(expireWaitingTask, waitTimeoutMs, queue.tasks[taskId]);
  queue.tasks[taskId].waitTimeout.unref?.();
  schedule(queue);

  return taskId;
};

QueueManagerPort.removeFromQueueAdapter = (
  { queueLabel, taskId }
) => {
  const queue = activeQueue[queueLabel];
  if (!queue) { return false; }
  const task = queue.tasks[taskId];
  if (!task || !task.running) { return false; }
  releaseRunningTask(task);
  return true;
};

QueueManagerPort.removeTasksByOriginAdapter = (
  { origin }
) => {
  if (!origin) return { success: false, removed: 0 };

  let removed = 0;
  for (const queue of Object.values(activeQueue)) {
    if (!queue) continue;

    for (let i = 0; i < queue.maxWaiting; i++) {
      const task = queue.tasks[i];
      if (!task || task.origin !== origin) continue;

      if (task.running) {
        releaseRunningTask(task);
      } else {
        releaseWaitingTask(task);
      }
      removed += 1;
    }
  }

  return { success: true, removed, origin };
};

module.exports = QueueManagerPort;
Object.freeze(QueueManagerPort);

/**
 * 
 * INTERNAL STRUCTURE
 * 
 */

/** @param {Queue} queue  */
const schedule = (queue) => {
  if (queue.running >= queue.maxConcurrent) { return; }

  for (let tid = 0; tid < queue.maxWaiting; tid++) {
    const task = queue.tasks[tid];
    if (!task || task.running) { continue; }
    queue.running++; queue.waiting--;
    task.running = true;
    if (task.waitTimeout) {
      clearTimeout(task.waitTimeout);
      task.waitTimeout = null;
    }
    task.delayedAnswer({
      success: true,
      queueLabel: queue.label,
      taskId: task.taskId,
      first: task.first
    });

    if (queue.running == queue.maxConcurrent) { break; }
  }

  if (queue.running + queue.waiting === 0) { dropQueue(queue); }
}


/** @param {Queue} queue */
const getTaskId = async (queue) => {
  if (queue.waiting + queue.running < queue.maxWaiting) {
    for (let i = 0; i < queue.maxWaiting; i++)
      if (!queue.tasks[i]) return i;
  }
  return false;
};

const getQueue = (label, maxConcurrent, maxWaiting) => {
  const queue = queuePool.pop() ?? new Queue(defaultWaitingMax);
  return queue.init(label, maxConcurrent, maxWaiting);
};

const dropQueue = (queue) => {
  queue.clear();
  delete activeQueue[queue.label];
  if (queuePool.length < queuePoolMax) queuePool.push(queue);
};

const getTask = (params) => {
  const task = taskPool.pop() ?? new Task();
  return task.init(params);
};

const releaseRunningTask = (task) => {
  const queue = task.queue;
  const taskId = task.taskId;
  delete task.queue.tasks[task.taskId];
  if (task.waitTimeout) clearTimeout(task.waitTimeout);
  task.running = false;
  task.queue.running--;
  schedule(task.queue);
  task.queue = null;
  task.delayedAnswer = null;
  task.waitTimeout = null;
  task.origin = null;
  if (taskPool.length < taskPoolMax) taskPool.push(task);
  if (queue.running + queue.waiting === 0) { dropQueue(queue); }
};

const expireWaitingTask = (task) => {
  if (!task?.queue || task.running) { return; }

  const queue = task.queue;
  delete queue.tasks[task.taskId];
  if (queue.waiting > 0) queue.waiting--;
  task.waitTimeout = null;

  task.delayedAnswer?.({
    success: false,
    reason: `queue_wait_timeout`,
    queueLabel: queue.label,
    taskId: task.taskId
  });

  task.queue = null;
  task.delayedAnswer = null;
  task.origin = null;
  if (queue.running + queue.waiting === 0) { dropQueue(queue); }
  if (taskPool.length < taskPoolMax) taskPool.push(task);
};

const releaseWaitingTask = (task) => {
  if (!task?.queue || task.running) return;

  const queue = task.queue;
  delete queue.tasks[task.taskId];
  if (task.waitTimeout) clearTimeout(task.waitTimeout);
  if (queue.waiting > 0) queue.waiting--;
  task.queue = null;
  task.delayedAnswer = null;
  task.waitTimeout = null;
  task.origin = null;
  if (queue.running >= 0) schedule(queue);
  if (queue.running + queue.waiting === 0) { dropQueue(queue); }
  if (taskPool.length < taskPoolMax) taskPool.push(task);
};

class Task {
  /** @type {number | null} */
  waitTimeoutMs;
  /** @type {Queue} */
  queue;
  /** @type {((task: {queueLabel, taskId, first}) => any) | null} */
  delayedAnswer;
  /** @type {number} */
  taskId;
  /** @type {string | null} */
  origin;
  /** @type {boolean} */
  running;
  /** @type {boolean} */
  first;
  /** @type {NodeJS.Timeout | null} */
  waitTimeout;

  constructor() { }

  init({ waitTimeoutMs, queue, delayedAnswer, taskId, origin, first }) {
    this.waitTimeoutMs = waitTimeoutMs;
    this.queue = queue;
    this.delayedAnswer = delayedAnswer;
    this.taskId = taskId;
    this.origin = origin ?? null;
    this.running = false;
    this.first = first;
    this.waitTimeout = null;
    Object.preventExtensions(this);
    return this;
  }
}

class Queue {
  /** @type {string | null} */
  label;
  /** @type {number} */
  maxConcurrent;
  /** @type {number} */
  maxWaiting;
  /** @type {number} */
  running;
  /** @type {number} */
  waiting;
  /** @type {(Task | undefined)[]} */
  tasks;

  constructor(maxWaiting) {
    this.tasks = new Array(maxWaiting);
  }

  clear() {
    for (let i = 0, l = this.tasks.length; i < l; i++) {
      if (this.tasks[i]?.waitTimeout) clearTimeout(this.tasks[i].waitTimeout);
      delete this.tasks[i];
    }
  }

  init(label, maxConcurrent, maxWaiting) {
    this.label = label;
    this.maxConcurrent = maxConcurrent;
    this.maxWaiting = Math.max(1, maxWaiting ?? defaultWaitingMax);
    if (this.tasks.length !== this.maxWaiting) {
      this.tasks = new Array(this.maxWaiting);
    }
    this.running = 0;
    this.waiting = 0;
    Object.preventExtensions(this);
    return this;
  }
}
