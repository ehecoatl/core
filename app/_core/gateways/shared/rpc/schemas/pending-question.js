// _core/gateways/shared/rpc/schemas/pending-question.js


'use strict';


/** Mutable pending-question instance that stores answer/error state until an RPC reply arrives. */
class PendingQuestion {
  id;
  target;
  question;
  requestData;
  answer;
  error;
  completed;
  detailed;
  resolveTimeout;
  rejectTimeout;

  /** Stores correlation data and binds resolve/reject handlers to the owning endpoint cleanup flow. */
  constructor({ id, target, question, requestData, detailed = false, resolve, reject }) {
    this.id = id;
    this.target = target;
    this.question = question;
    this.requestData = requestData;
    this.answer = undefined;
    this.error = null;
    this.completed = false;
    this.detailed = detailed;
    this.resolveTimeout = null;
    this.rejectTimeout = null;
    this.resolve = resolve;
    this.reject = reject;
  }

  /** Persists timeout resolver references until the question is completed or times out. */
  attachTimeoutHandlers(resolveTimeout, rejectTimeout) {
    //ALREADY RECEIVED? IMMEDIATE PROMISE
    const { completed, error, answer } = this;
    if (completed) {
      if (error) { rejectTimeout(error); return; }
      resolveTimeout(answer);
      return;
    }

    //WAIT FOR DELAYED RECEIVING
    this.resolveTimeout = resolveTimeout;
    this.rejectTimeout = rejectTimeout;
  }

  /** Stores the terminal answer/error state and notifies any waiting timeout promise handlers. */
  complete({ answer = undefined, error = undefined } = {}) {
    this.answer = answer;
    this.error = error;
    this.completed = true;
    if (error) { this.rejectTimeout?.(error); }
    else { this.resolveTimeout?.(answer); }
  }
}

module.exports = PendingQuestion;
Object.freeze(module.exports);
