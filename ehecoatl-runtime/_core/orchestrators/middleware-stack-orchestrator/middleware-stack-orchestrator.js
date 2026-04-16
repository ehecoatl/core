// _core/orchestrators/middleware-stack-orchestrator/middleware-stack-orchestrator.js


'use strict';


const MiddlewareContext = require(`./middleware-context`);

/** Transport orchestrator use case that executes ordered HTTP middleware stacks with hook-aware flow control. */
class MiddlewareStackOrchestrator {
  maxInputBytes;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;
  middlewareStackResolver;

  /** Captures middleware stack config, executor access, and middleware registries for request execution. */
  constructor(kernelContext) {
    this.config = kernelContext.config.adapters.middlewareStackOrchestrator;
    this.maxInputBytes = this.config.maxInputBytes;
    this.plugin = kernelContext.pluginOrchestrator;
    this.middlewareStackResolver = kernelContext.useCases.middlewareStackResolver;

    Object.freeze(this);
  }

  /**
   * Executes the configured HTTP middleware stacks with middleware lifecycle hooks.
   * @param {import('@/_core/runtimes/ingress-runtime/execution/execution-context')} executionContext
   */
  async runHttpMiddlewareStack(executionContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const stackHooks = hooks.TRANSPORT.MIDDLEWARE_STACK;
    try {
      if (executionContext.isAborted() || executionContext.tenantRoute.isRedirect()) {
        await plugin.run(stackHooks.BREAK, executionContext, stackHooks.ERROR);
        return;
      }

      const coreStackResult = await this.#runHttpStack({
        descriptors: this.#buildCoreHttpStack(executionContext),
        executionContext,
        stackContext: executionContext
      });

      if (!coreStackResult.completedAll || executionContext.isAborted()) {
        return;
      }

      const routeStackDescriptors = await this.#buildRouteHttpStack(executionContext);
      if (routeStackDescriptors.length === 0) {
        return;
      }

      await this.#runHttpStack({
        descriptors: routeStackDescriptors,
        executionContext,
        stackContext: new MiddlewareContext(executionContext)
      });
    } catch (error) {
      await plugin.run(stackHooks.ERROR, executionContext);
      executionContext.responseData.status = 500;
      executionContext.responseData.body = `Internal Server Middleware Stack Error`;
    } finally {
      executionContext.meta.currentMiddlewareIndex = null;
      executionContext.meta.currentMiddlewareName = null;
      await executionContext.callFinishCallbacks();
    }
  }

  /**
   * Runs one async middleware stack and reports whether the full chain reached the end.
   * @param {{
   * descriptors: Array<{ name: string, execute: (stackContext: any, next: ()=>Promise<void>) => Promise<any> }>,
   * executionContext: import('@/_core/runtimes/ingress-runtime/execution/execution-context'),
   * stackContext: any
   * }} params
   */
  async #runHttpStack({
    descriptors,
    executionContext,
    stackContext
  }) {
    const plugin = this.plugin;
    const stackHooks = plugin.hooks.TRANSPORT.MIDDLEWARE_STACK;
    const middlewareHooks = stackHooks.MIDDLEWARE;

    await plugin.run(stackHooks.START, executionContext, stackHooks.ERROR);
    const completedAll = await this.#dispatchHttpStack({
      descriptors,
      executionContext,
      stackContext,
      middlewareHooks,
      index: 0
    });

    if (!completedAll || executionContext.isAborted()) {
      await plugin.run(stackHooks.BREAK, executionContext, stackHooks.ERROR);
      return { completedAll: false };
    }

    await plugin.run(stackHooks.END, executionContext, stackHooks.ERROR);
    return { completedAll: true };
  }

  async #dispatchHttpStack({
    descriptors,
    executionContext,
    stackContext,
    middlewareHooks,
    index
  }) {
    if (index >= descriptors.length) {
      return true;
    }

    const descriptor = descriptors[index];
    executionContext.meta.currentMiddlewareIndex = index;
    executionContext.meta.currentMiddlewareName = descriptor?.name ?? `middleware_${index}`;
    await this.plugin.run(middlewareHooks.START, executionContext, middlewareHooks.ERROR);

    let nextCalled = false;
    let childCompleted = false;
    await descriptor.execute(stackContext, async () => {
      if (nextCalled) {
        throw new Error(`next() called multiple times by middleware "${descriptor.name}"`);
      }
      nextCalled = true;
      childCompleted = await this.#dispatchHttpStack({
        descriptors,
        executionContext,
        stackContext,
        middlewareHooks,
        index: index + 1
      });
    });

    await this.plugin.run(middlewareHooks.END, executionContext, middlewareHooks.ERROR);

    if (nextCalled) {
      return childCompleted;
    }

    return index === (descriptors.length - 1);
  }

  #buildCoreHttpStack(executionContext) {
    const registry = this.middlewareStackResolver.getCoreMiddlewares();
    return this.middlewareStackResolver.getCoreMiddlewareOrder()
      .map((middlewareName) => {
        const middleware = registry[middlewareName];
        if (typeof middleware !== `function`) {
          throw new Error(`Core middleware "${middlewareName}" is not executable`);
        }
        return Object.freeze({
          name: middlewareName,
          execute: async (_, next) => middleware(executionContext, next)
        });
      });
  }

  async #buildRouteHttpStack(executionContext) {
    const middlewareLabels = Array.isArray(executionContext.tenantRoute?.middleware)
      ? executionContext.tenantRoute.middleware
      : [];
    if (middlewareLabels.length === 0) {
      return [];
    }

    const tenantHttpMiddlewares = this.middlewareStackResolver.getTenantMiddlewares().http;
    const appId = executionContext.tenantRoute?.origin?.appId ?? null;
    const appHttpMiddlewares = appId
      ? (await this.middlewareStackResolver.loadAppMiddlewares(appId)).http
      : {};

    return middlewareLabels.map((middlewareLabel) => {
      const middleware = appHttpMiddlewares[middlewareLabel] ?? tenantHttpMiddlewares[middlewareLabel] ?? null;
      if (typeof middleware !== `function`) {
        throw new Error(`Route middleware "${middlewareLabel}" was not found for tenant/app HTTP registries`);
      }

      return Object.freeze({
        name: middlewareLabel,
        execute: async (middlewareContext, next) => middleware(middlewareContext, next)
      });
    });
  }
}

module.exports = MiddlewareStackOrchestrator;
Object.freeze(module.exports);
