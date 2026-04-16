'use strict';

// This middleware receives the public MiddlewareContext facade, not the raw
// ExecutionContext. Use it for tenant/app custom logic without internal access.
// Put your request preprocessing logic here.
// Call next() to continue the stack or return early to stop it.
/**
 * Async execution middleware method
 * @param {import('@/_core/orchestrators/middleware-stack-orchestrator/middleware-context')} context
 * @param {()=>Promise<void>} next
 * @returns {Promise<void>}
 */
module.exports = async function (context, next) {
  void context;
  return await next();
};
