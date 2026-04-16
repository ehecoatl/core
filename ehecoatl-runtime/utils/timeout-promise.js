// utils/timeout-promise.js


'use strict';


/**
 * Runs an executor with resolve/reject controls and rejects if it exceeds the timeout window.
 * @param {(resolve: (value?: any) => void, reject: (error?: any) => void) => any} executor
 * @param {number} timeoutMs
 * @param {string} [message]
 */
module.exports = function timeoutPromise(executor, timeoutMs, message = `Operation timeout after ${timeoutMs}ms`) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    timer.unref?.();

    const onResolve = (value) => {
      clearTimeout(timer);
      resolve(value);
    };

    const onReject = (error) => {
      clearTimeout(timer);
      reject(error);
    };

    Promise.resolve()
      .then(() => executor(onResolve, onReject))
      .catch(onReject);
  });
};

Object.freeze(module.exports);
