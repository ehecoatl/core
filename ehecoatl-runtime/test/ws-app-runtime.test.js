'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const WsAppRuntime = require(`@/_core/runtimes/ws-app-runtime`);

test(`ws app runtime auto-prefixes channel ids and targets tenant transport`, async () => {
  const calls = [];
  const runtime = new WsAppRuntime({
    config: {
      adapters: {
        wsHubManager: {
          question: {
            command: `wsHub`
          }
        }
      }
    },
    rpcEndpoint: {
      async ask(payload) {
        calls.push(payload);
        return { success: true };
      }
    },
    tenantId: `aaaaaaaaaaaa`,
    appId: `bbbbbbbbbbbb`
  });
  const service = runtime.createService();

  await service.listChannels();
  await service.listClients({
    channelId: `/chat`
  });
  await service.sendMessage({
    channelId: `cccccccccccc:/external`,
    clientId: `client-1`,
    message: `hello`
  });

  assert.deepEqual(calls[0], {
    target: `e_transport_aaaaaaaaaaaa`,
    question: `wsHub`,
    data: {
      command: `listChannels`,
      appId: `bbbbbbbbbbbb`
    }
  });
  assert.deepEqual(calls[1], {
    target: `e_transport_aaaaaaaaaaaa`,
    question: `wsHub`,
    data: {
      command: `listClients`,
      channelId: `bbbbbbbbbbbb:/chat`
    }
  });
  assert.deepEqual(calls[2], {
    target: `e_transport_aaaaaaaaaaaa`,
    question: `wsHub`,
    data: {
      command: `sendMessage`,
      channelId: `cccccccccccc:/external`,
      clientId: `client-1`,
      message: `hello`,
      metadata: {},
      isBinary: null
    }
  });
});
