'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const AppRpcRuntime = require(`../_core/runtimes/app-rpc-runtime`);

test(`app rpc runtime enriches ask payloads with app identity metadata`, async () => {
  const calls = [];
  const runtime = new AppRpcRuntime({
    rpcEndpoint: {
      async ask(payload) {
        calls.push(payload);
        return { ok: true };
      }
    },
    tenantId: `tenant_abc`,
    appId: `app_xyz`
  });

  const service = runtime.createService();
  await service.ask({
    target: `main`,
    question: `state`,
    data: {
      state: `ready`
    },
    internalMeta: {
      traceId: `trace-1`
    }
  });

  assert.deepEqual(calls[0], {
    target: `main`,
    question: `state`,
    data: {
      state: `ready`
    },
    internalMeta: {
      traceId: `trace-1`,
      appRpcContext: {
        tenantId: `tenant_abc`,
        appId: `app_xyz`
      }
    }
  });
});

test(`app rpc runtime accepts question envelopes and maps them to rpc question plus payload`, async () => {
  const calls = [];
  const runtime = new AppRpcRuntime({
    rpcEndpoint: {
      async askDetailed(payload) {
        calls.push(payload);
        return { data: { ok: true }, internalMeta: null };
      }
    },
    tenantId: `tenant_abc`,
    appId: `app_xyz`
  });

  const service = runtime.createService();
  await service.askDetailed({
    target: `main`,
    question: {
      type: `cli.command.run`,
      payload: {
        commandLine: `ehecoatl tenant status`
      }
    }
  });

  assert.deepEqual(calls[0], {
    target: `main`,
    question: `cli.command.run`,
    data: {
      commandLine: `ehecoatl tenant status`
    },
    internalMeta: {
      appRpcContext: {
        tenantId: `tenant_abc`,
        appId: `app_xyz`
      }
    }
  });
});
