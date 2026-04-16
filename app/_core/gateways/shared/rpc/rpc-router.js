// _core/gateways/shared/rpc/rpc-router.js


'use strict';

const RpcEndpoint = require("./rpc-endpoint");
const RpcChannel = require("./rpc-channel");
const GatewayCore = require(`g@/gateway-core`);

/** Shared RPC router that resolves labeled process targets and forwards IPC messages. */
class RpcRouter extends GatewayCore {
  /** @type {typeof import('@/config/default.config')['rpc']} */
  config;

  /** @type {RpcChannel}  */
  channel;
  /** @type {RpcEndpoint} */
  endpoint;
  /** @type {import('@/_core/boot/plugin-executor')} */
  plugin;
  /** @type {import('./rpc-adapter')} */
  adapter = null;

  /** @type {Map<string,(...any)=>any>} */
  temporaryPreffixSpawner;

  constructor(kernelContext) {
    super(kernelContext.config._adapters.rpc);
    this.config = kernelContext.config.rpc;
    this.plugin = kernelContext.plugin;
    super.loadAdapter();
    this.channel = new RpcChannel(this.adapter);
    this.endpoint = new RpcEndpoint(kernelContext, {
      channel: this.channel,
      routeAnswer: (target, payload) => this.routeTo(target, payload)
    });
    this.children = new Map();
    //this.parents = new Map();
    this.temporaryPreffixSpawner = new Map();
  }

  registerTarget(label, processHandleOrLabel) {
    this.children.set(label, processHandleOrLabel);
  }

  unregisterTarget(label) {
    this.children.delete(label);
  }

  resolveRoute(endpointLabelOrProcess) {
    if (!endpointLabelOrProcess) return null;
    if (typeof endpointLabelOrProcess !== "string") return endpointLabelOrProcess;
    return this.children.get(endpointLabelOrProcess) ?? null;// ?? this.parents.get(endpointLabelOrProcess)
  }

  async routeTo(endpointTarget, payload) {
    const { ERROR, RECEIVED, ROUTED } = this.plugin.hooks.SHARED.RPC_ROUTER;
    const targetProcess = this.resolveRoute(endpointTarget);

    await this.plugin.run(RECEIVED, {}, ERROR);

    if (!targetProcess) {
      if (typeof endpointTarget !== `string`) {
        await this.plugin.run(ERROR, {});
        return undefined;
      }
      for (const [preffix, spawnCallback] of this.temporaryPreffixSpawner) {
        if (endpointTarget.startsWith(preffix)) {
          const spawnStartedAt = Date.now();
          if (await spawnCallback(endpointTarget, payload)) {
            attachColdWaitMeta(payload, Date.now() - spawnStartedAt);
            const success = await this.channel.sendMessage(this.resolveRoute(endpointTarget), payload);
            await this.plugin.run(success ? ROUTED : ERROR, {}, ERROR);
            return true;
          }
        }
      }
      await this.plugin.run(ERROR, {});
      return undefined; // TARGET NOT FOUND
    }

    const success = await this.channel.sendMessage(targetProcess, payload);
    await this.plugin.run(success ? ROUTED : ERROR, {}, ERROR);
  }

  bindTemporarySpawner(preffix, spawnCallback) {
    this.temporaryPreffixSpawner.set(preffix, spawnCallback);
  }
}

function attachColdWaitMeta(payload, coldWaitMs) {
  if (!payload || !payload.data?.tenantRoute?.controller) return;

  payload.internalMeta = {
    ...(payload.internalMeta ?? {}),
    controllerMeta: {
      ...(payload.internalMeta?.controllerMeta ?? {}),
      coldWaitMs
    }
  };
}

module.exports = RpcRouter;
Object.freeze(module.exports);
