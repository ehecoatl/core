'use strict';

const { createResponseCacheInternalRedirect } = require(`./_static-stream-support`);

module.exports = async function runMiddleware(executionContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute, services, requestData } = executionContext;
  const { cache } = services;

  if (tenantRoute.isStaticAsset()) {
    return forward.continue();
  }
  if (tenantRoute.cache === `no-cache`) {
    return forward.continue();
  }

  const cacheKey = `validResponseCache:${requestData.url}`;
  const cachePath = await cache.get(cacheKey, null);
  if (cachePath) {
    const internalRedirect = await createResponseCacheInternalRedirect(executionContext, cachePath);
    if (internalRedirect) {
      setBody(executionContext, internalRedirect);
      if (executionContext.meta) {
        executionContext.meta.cached = true;
      }
      return forward.break();
    }
    if (typeof cache.delete === `function`) {
      await cache.delete(cacheKey);
    }
    return forward.continue();
  }

  const queueLabel = cacheKey;
  const maxConcurrent = 1;
  const waitTimeoutMs = 10000;
  const task = await askDirector(executionContext, `queue`, {
    queueLabel,
    maxConcurrent,
    waitTimeoutMs
  });
  if (task?.success === false) {
    return forward.continue();
  }
  if (task && !task.first) {
    await askDirector(executionContext, `dequeue`, {
      queueLabel,
      taskId: task.taskId
    });
    return module.exports(executionContext, next);
  }
  if (task?.taskId) {
    executionContext.addFinishCallback(() => {
      return askDirector(executionContext, `dequeue`, {
        queueLabel,
        taskId: task.taskId
      });
    });
  }

  return forward.continue();
};

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}

function askDirector(executionContext, question, data) {
  if (typeof executionContext?.askDirector === `function`) {
    return executionContext.askDirector(question, data);
  }
  if (typeof executionContext?.askManager === `function`) {
    return executionContext.askManager(question, data);
  }
  return executionContext?.directorHelper?.askDirector(question, data);
}

function setBody(executionContext, body) {
  if (typeof executionContext?.setBody === `function`) {
    executionContext.setBody(body);
    return;
  }
  if (executionContext?.responseData) {
    executionContext.responseData.body = body;
  }
}
