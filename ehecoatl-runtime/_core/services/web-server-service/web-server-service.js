// _core/services/web-server-service/web-server-service.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Director-owned service that manages web server setup and tenant-registry propagation. */
class WebServerService extends AdaptableUseCase {
  /** @type {typeof import('@/config/default.config').adapters.webServerService} */
  config;
  plugin;
  kernelContext;

  /** @param {import('@/_core/kernel/kernel')} kernelContext */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.webServerService);
    this.kernelContext = kernelContext;
    this.config = kernelContext.config.adapters.webServerService;
    this.plugin = kernelContext.pluginOrchestrator;

    Object.freeze(this);
  }

  async setupServer() {
    const setupServerAdapter = this.adapter?.setupServerAdapter;
    if (typeof setupServerAdapter !== `function`) {
      return null;
    }
    return await setupServerAdapter(this.#buildAdapterConfig());
  }

  async updateSource(source, routeType = null) {
    const updateSourceAdapter = this.adapter?.updateSourceAdapter;
    if (typeof updateSourceAdapter !== `function`) {
      return null;
    }
    return await updateSourceAdapter(source, routeType, this.#buildAdapterConfig());
  }

  async removeSource(sourceKey) {
    const removeSourceAdapter = this.adapter?.removeSourceAdapter;
    if (typeof removeSourceAdapter !== `function`) {
      return null;
    }
    return await removeSourceAdapter(sourceKey, this.#buildAdapterConfig());
  }

  async flushChanges() {
    const flushChangesAdapter = this.adapter?.flushChangesAdapter;
    if (typeof flushChangesAdapter !== `function`) {
      return null;
    }
    return await flushChangesAdapter(this.#buildAdapterConfig());
  }

  #buildAdapterConfig() {
    return {
      ...this.config,
      getCertificatePath: async (domain, tenantId = null) => {
        const certificateService = this.kernelContext?.useCases?.certificateService ?? null;
        if (!certificateService?.getCertificatePath) {
          return null;
        }
        return await certificateService.getCertificatePath(domain, tenantId);
      },
      privilegedHostOperation: async (operation, payload = {}) => {
        const rpcEndpoint = this.kernelContext?.useCases?.rpcEndpoint ?? null;
        if (!rpcEndpoint?.ask) {
          throw new Error(`web-server-service privileged host operation requires rpcEndpoint`);
        }
        const response = await rpcEndpoint.ask({
          target: `main`,
          question: `privilegedHostOperation`,
          data: { operation, payload }
        });
        if (response?.success === false) {
          throw new Error(response?.error ?? `Privileged host operation failed`);
        }
        return response?.result ?? null;
      }
    };
  }
}

module.exports = WebServerService;
Object.freeze(module.exports);
