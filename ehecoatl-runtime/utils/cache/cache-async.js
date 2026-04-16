// utils/cache/cache-async.js


'use strict';

const defaultTimeoutMs = 500;

function runAsyncCacheTask({
  channel = `cache_async`,
  operation = `unknown`,
  timeoutMs = defaultTimeoutMs,
  details = {},
  execute
}) {
  if (typeof execute !== `function`) return;

  Promise.resolve()
    .then(() => withTimeout(Promise.resolve().then(() => execute()), timeoutMs))
    .catch((error) => {
      logAsyncCacheFailure({
        channel,
        operation,
        timeoutMs,
        details,
        error
      });
    });
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error(`Async cache task timed out after ${timeoutMs}ms`);
      error.code = `CACHE_ASYNC_TIMEOUT`;
      reject(error);
    }, timeoutMs);
    timeout.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function logAsyncCacheFailure({
  channel,
  operation,
  timeoutMs,
  details,
  error
}) {
  const compactDetails = Object.entries(details ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== ``)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(` `);

  console.error(
    `[cache-async][${channel}] operation="${operation}" timeoutMs=${timeoutMs}${compactDetails ? ` ${compactDetails}` : ``}`
  );
  console.error(
    `[cache-async][${channel}] ${error?.stack ?? error?.message ?? String(error)}`
  );
}

module.exports = Object.freeze({
  runAsyncCacheTask
});
