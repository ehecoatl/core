// _core/runtimes/middleware-stack-runtime/middleware-stack-runtime.js


'use strict';


const MiddlewareContext = require(`./middleware-context`);

/** Transport orchestrator use case that executes ordered HTTP middleware stacks with hook-aware flow control. */
class MiddlewareStackRuntime {
  maxInputBytes;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;
  middlewareStackResolver;

  /** Captures middleware stack config, executor access, and middleware registries for request execution. */
  constructor(kernelContext) {
    this.config = kernelContext.config.adapters.middlewareStackRuntime;
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

      const middlewareContext = new MiddlewareContext(executionContext);
      const descriptors = await this.#buildUnifiedHttpStack(middlewareContext);
      await this.#runStack({
        descriptors,
        executionContext,
        stackContext: middlewareContext
      });
    } catch (error) {
      console.error(`[middleware-stack-runtime] http stack failed`, {
        url: executionContext?.requestData?.url ?? null,
        route: executionContext?.tenantRoute?.pointsTo ?? null,
        error: error?.stack ?? error?.message ?? error
      });
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
   * Executes route-bound HTTP middlewares followed by optional app ws-upgrade middleware.
   * @param {import('@/_core/runtimes/ingress-runtime/execution/execution-context')} executionContext
   */
  async runWsUpgradeMiddlewareStack(executionContext) {
    const plugin = this.plugin;
    const { hooks } = plugin;
    const stackHooks = hooks.TRANSPORT.MIDDLEWARE_STACK;
    try {
      if (executionContext.isAborted() || !executionContext.tenantRoute) {
        await plugin.run(stackHooks.BREAK, executionContext, stackHooks.ERROR);
        return;
      }

      const middlewareContext = new MiddlewareContext(executionContext);
      const descriptors = await this.#buildWsUpgradeStack(middlewareContext);
      await this.#runStack({
        descriptors,
        executionContext,
        stackContext: middlewareContext
      });
    } catch (error) {
      console.error(`[middleware-stack-runtime] ws-upgrade stack failed`, {
        url: executionContext?.requestData?.url ?? null,
        route: executionContext?.tenantRoute?.pointsTo ?? null,
        error: error?.stack ?? error?.message ?? error
      });
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
  async #runStack({
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

  async #buildUnifiedHttpStack(middlewareContext) {
    const routeDescriptors = await this.#buildRouteHttpStack(middlewareContext);
    const coreDescriptors = this.#buildCoreHttpStack(middlewareContext);
    return [...routeDescriptors, ...coreDescriptors];
  }

  async #buildWsUpgradeStack(middlewareContext) {
    const routeDescriptors = await this.#buildRouteHttpStack(middlewareContext);
    const wsUpgradeDescriptor = await this.#buildWsUpgradeDescriptor(middlewareContext);
    return wsUpgradeDescriptor
      ? [...routeDescriptors, wsUpgradeDescriptor]
      : routeDescriptors;
  }

  #buildCoreHttpStack(middlewareContext) {
    const registry = this.middlewareStackResolver.getCoreMiddlewares(`http`);
    return this.middlewareStackResolver.getCoreMiddlewareOrder(`http`)
      .map((middlewareName) => {
        const middleware = registry[middlewareName];
        if (typeof middleware !== `function`) {
          throw new Error(`Core middleware "${middlewareName}" is not executable`);
        }
        return Object.freeze({
          name: middlewareName,
          execute: async (stackContext, next) => middleware(stackContext ?? middlewareContext, next)
        });
      });
  }

  async #buildRouteHttpStack(middlewareContext) {
    const middlewareLabels = Array.isArray(middlewareContext.tenantRoute?.middleware)
      ? middlewareContext.tenantRoute.middleware
      : [];
    if (middlewareLabels.length === 0) {
      return [];
    }

    const tenantHttpMiddlewares = this.middlewareStackResolver.getTenantMiddlewares().http;
    const appId = middlewareContext.tenantRoute?.origin?.appId ?? null;
    const appMiddlewarePaths = resolveAppMiddlewarePathsFromRoute(middlewareContext.tenantRoute);
    const appHttpMiddlewares = appId
      ? (await this.middlewareStackResolver.loadAppMiddlewares(appId, {
          pathsByProtocol: appMiddlewarePaths
        })).http
      : {};

    return middlewareLabels.map((middlewareLabel) => {
      const middleware = appHttpMiddlewares[middlewareLabel] ?? tenantHttpMiddlewares[middlewareLabel] ?? null;
      if (typeof middleware !== `function`) {
        throw new Error(`Route middleware "${middlewareLabel}" was not found for tenant/app HTTP registries`);
      }

      return Object.freeze({
          name: middlewareLabel,
          execute: async (stackContext, next) => middleware(stackContext ?? middlewareContext, next)
      });
    });
  }

  async #buildWsUpgradeDescriptor(middlewareContext) {
    const appId = middlewareContext.tenantRoute?.origin?.appId ?? null;
    if (!appId) return null;

    const appWsMiddlewares = (await this.middlewareStackResolver.loadAppMiddlewares(appId, {
      pathsByProtocol: resolveAppMiddlewarePathsFromRoute(middlewareContext.tenantRoute)
    })).ws ?? {};
    const middleware = appWsMiddlewares[`ws-upgrade`] ?? null;
    if (typeof middleware !== `function`) return null;

    return Object.freeze({
      name: `ws-upgrade`,
      execute: async (stackContext, next) => middleware(stackContext ?? middlewareContext, next)
    });
  }
}

function resolveAppMiddlewarePathsFromRoute(tenantRoute) {
  const folders = tenantRoute?.folders ?? {};
  const httpPath = typeof folders.httpMiddlewaresRootFolder === `string` && folders.httpMiddlewaresRootFolder.trim()
    ? folders.httpMiddlewaresRootFolder.trim()
    : null;
  const wsPath = typeof folders.wsMiddlewaresRootFolder === `string` && folders.wsMiddlewaresRootFolder.trim()
    ? folders.wsMiddlewaresRootFolder.trim()
    : null;

  if (!httpPath && !wsPath) {
    return null;
  }

  return Object.freeze({
    http: httpPath,
    ws: wsPath
  });
}

module.exports = MiddlewareStackRuntime;
Object.freeze(module.exports);
