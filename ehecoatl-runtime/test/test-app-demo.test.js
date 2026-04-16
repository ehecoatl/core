'use strict';

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const testApp = require(`../extensions/app-kits/test-app`);

test(`test-app ws ticker is a no-op when there are no open channels`, async () => {
  const calls = [];
  const ticker = testApp.createWsTicker({
    appName: `www`,
    services: {
      ws: {
        async listChannels() {
          calls.push([`listChannels`]);
          return [];
        },
        async broadcastMessage() {
          calls.push([`broadcastMessage`]);
          return { success: true, delivered: 1 };
        }
      }
    },
    nowProvider: () => new Date(`2026-04-09T00:00:00.000Z`)
  });

  const summary = await ticker.publishTick();

  assert.deepEqual(summary, {
    attempted: 0,
    delivered: 0,
    skipped: 0,
    channels: []
  });
  assert.deepEqual(calls, [[`listChannels`]]);
});

test(`test-app ws ticker broadcasts each active channel and ignores channel_not_found`, async () => {
  const calls = [];
  const ticker = testApp.createWsTicker({
    appName: `www`,
    services: {
      ws: {
        async listChannels() {
          return [
            `bbbbbbbbbbbb:/ws`,
            `bbbbbbbbbbbb:/ws/auth/private/42`,
            `bbbbbbbbbbbb:/ws`
          ];
        },
        async broadcastMessage(payload) {
          calls.push(payload);
          if (payload.channelId === `bbbbbbbbbbbb:/ws/auth/private/42`) {
            return {
              success: false,
              reason: `channel_not_found`
            };
          }
          return {
            success: true,
            delivered: 2
          };
        }
      }
    },
    nowProvider: () => new Date(`2026-04-09T12:34:56.000Z`)
  });

  const summary = await ticker.publishTick();

  assert.deepEqual(summary, {
    attempted: 2,
    delivered: 2,
    skipped: 1,
    channels: [
      `bbbbbbbbbbbb:/ws`,
      `bbbbbbbbbbbb:/ws/auth/private/42`
    ]
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    channelId: `bbbbbbbbbbbb:/ws`,
    message: {
      type: `tick`,
      channelId: `bbbbbbbbbbbb:/ws`,
      appName: `www`,
      timestampUtc: `2026-04-09T12:34:56.000Z`,
      unixMs: 1775738096000
    }
  });
});
