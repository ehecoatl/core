'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const WsHubManager = require(`@/_core/managers/ws-hub-manager`);

test(`ws hub manager lazily creates channels and sends messages only to intended clients`, async () => {
  const manager = createWsHubManager();
  const wsA = createMockWs();
  const wsB = createMockWs();
  const wsOther = createMockWs();

  await manager.openClient({
    channelId: `bbbbbbbbbbbb:/chat`,
    clientId: `client-a`,
    ws: wsA,
    metadata: {
      role: `alpha`
    }
  });
  await manager.openClient({
    channelId: `bbbbbbbbbbbb:/chat`,
    clientId: `client-b`,
    ws: wsB,
    metadata: {
      role: `beta`
    }
  });
  await manager.openClient({
    channelId: `cccccccccccc:/external`,
    clientId: `client-c`,
    ws: wsOther,
    metadata: {
      role: `gamma`
    }
  });

  assert.equal(manager.channelEntries.has(`bbbbbbbbbbbb:/chat`), true);
  assert.equal((await manager.listClients({
    channelId: `bbbbbbbbbbbb:/chat`
  })).length, 2);
  assert.deepEqual(await manager.listChannels(), [
    `bbbbbbbbbbbb:/chat`,
    `cccccccccccc:/external`
  ]);
  assert.deepEqual(await manager.listChannels({
    appId: `bbbbbbbbbbbb`
  }), [
    `bbbbbbbbbbbb:/chat`
  ]);

  await manager.sendMessage({
    channelId: `bbbbbbbbbbbb:/chat`,
    clientId: `client-a`,
    message: { ok: true }
  });
  assert.equal(wsA.sent.length, 1);
  assert.equal(wsB.sent.length, 0);
  assert.equal(wsA.sent[0].message, JSON.stringify({ ok: true }));

  await manager.broadcastMessage({
    channelId: `bbbbbbbbbbbb:/chat`,
    message: `hello`
  });
  assert.equal(wsA.sent.length, 2);
  assert.equal(wsB.sent.length, 1);

  const clientB = await manager.getClient({
    channelId: `bbbbbbbbbbbb:/chat`,
    clientId: `client-b`
  });
  assert.equal(clientB.metadata.role, `beta`);

  await manager.destroy();
});

test(`ws hub manager destroys idle zero-client channels and cancels pending teardown on reopen`, async () => {
  const manager = createWsHubManager({
    idleChannelCloseMs: 25
  });
  const wsA = createMockWs();
  const wsB = createMockWs();

  await manager.openClient({
    channelId: `bbbbbbbbbbbb:/presence`,
    clientId: `client-a`,
    ws: wsA
  });
  await manager.closeClient({
    channelId: `bbbbbbbbbbbb:/presence`,
    clientId: `client-a`
  });

  await wait(10);
  await manager.openClient({
    channelId: `bbbbbbbbbbbb:/presence`,
    clientId: `client-b`,
    ws: wsB
  });

  await wait(30);
  assert.equal(manager.channelEntries.has(`bbbbbbbbbbbb:/presence`), true);

  await manager.closeClient({
    channelId: `bbbbbbbbbbbb:/presence`,
    clientId: `client-b`
  });
  await wait(35);
  assert.equal(manager.channelEntries.has(`bbbbbbbbbbbb:/presence`), false);

  await manager.destroy();
});

function createWsHubManager({
  idleChannelCloseMs = 50
} = {}) {
  return new WsHubManager({
    config: {
      _adapters: {
        wsHubManager: {
          bundled: `@adapter/inbound/ws-hub-manager/local-memory`,
          custom: `@adapter/inbound/ws-hub-manager/local-memory`
        }
      },
      adapters: {
        wsHubManager: {
          adapter: `local-memory`,
          idleChannelCloseMs,
          question: {
            command: `wsHub`
          }
        }
      }
    }
  });
}

function createMockWs() {
  return {
    sent: [],
    send(message, isBinary) {
      this.sent.push({ message, isBinary });
      return true;
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
