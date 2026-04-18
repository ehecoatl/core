'use strict';

module.exports = {
  createWsTicker,

  boot({
    appDomain = null,
    appName = null,
    services = {}
  } = {}) {
    const ticker = createWsTicker({
      appName,
      services
    });
    ticker.start();

    return Object.freeze({
      appDomain,
      appName,
      bootedAtUtc: new Date().toISOString(),
      publishTick: ticker.publishTick,
      stop: ticker.stop
    });
  }
};

Object.freeze(module.exports);

function createWsTicker({
  appName = null,
  services = {},
  intervalMs = 1000,
  nowProvider = () => new Date()
} = {}) {
  const wsService = services?.ws ?? null;
  let timer = null;

  const publishTick = async () => {
    if (
      !wsService
      || typeof wsService.listChannels !== `function`
      || typeof wsService.broadcastMessage !== `function`
    ) {
      return createTickSummary();
    }

    const listedChannels = await wsService.listChannels();
    const channelIds = normalizeChannelIds(listedChannels);
    if (channelIds.length === 0) {
      return createTickSummary();
    }

    const now = normalizeNow(nowProvider);
    let delivered = 0;
    let skipped = 0;

    for (const channelId of channelIds) {
      try {
        const result = await wsService.broadcastMessage({
          channelId,
          message: createTickPayload({
            channelId,
            appName,
            now
          })
        });
        if (result?.success === false && result?.reason === `channel_not_found`) {
          skipped += 1;
          continue;
        }
        delivered += Math.max(0, Number(result?.delivered ?? 0) || 0);
      } catch (error) {
        console.error(`[test-app-kit] websocket tick publish failed`, {
          channelId,
          error: error?.stack ?? error?.message ?? error
        });
      }
    }

    return createTickSummary({
      attempted: channelIds.length,
      delivered,
      skipped,
      channels: channelIds
    });
  };

  const start = () => {
    if (timer || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return timer;
    }

    timer = setInterval(() => {
      publishTick().catch((error) => {
        console.error(`[test-app-kit] websocket tick cycle failed`, {
          error: error?.stack ?? error?.message ?? error
        });
      });
    }, intervalMs);
    timer.unref?.();
    return timer;
  };

  const stop = () => {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  };

  return Object.freeze({
    start,
    stop,
    publishTick
  });
}

function createTickPayload({
  channelId,
  appName,
  now
}) {
  return Object.freeze({
    type: `tick`,
    channelId,
    appName: normalizeNonEmptyString(appName),
    timestampUtc: now.toISOString(),
    unixMs: now.getTime()
  });
}

function createTickSummary({
  attempted = 0,
  delivered = 0,
  skipped = 0,
  channels = []
} = {}) {
  return Object.freeze({
    attempted,
    delivered,
    skipped,
    channels: Object.freeze([...channels])
  });
}

function normalizeChannelIds(channelIds) {
  const normalized = new Set();
  for (const channelId of Array.isArray(channelIds) ? channelIds : []) {
    const value = normalizeNonEmptyString(channelId);
    if (value) normalized.add(value);
  }
  return [...normalized];
}

function normalizeNow(nowProvider) {
  const value = typeof nowProvider === `function`
    ? nowProvider()
    : new Date();
  const now = value instanceof Date
    ? value
    : new Date(value);
  return Number.isNaN(now.getTime())
    ? new Date()
    : now;
}

function normalizeNonEmptyString(value) {
  if (typeof value !== `string`) return null;
  const normalized = value.trim();
  return normalized || null;
}
