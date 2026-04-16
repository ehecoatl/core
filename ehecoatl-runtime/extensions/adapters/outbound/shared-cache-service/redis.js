// adapters/shared/shared-cache-service/redis.js


'use strict';


const SharedCacheServicePort = require(`@/_core/_ports/outbound/shared-cache-service-port`);
const { createClient } = require('redis');

const redis = createClient({
  socket: {
    host: '127.0.0.1',
    port: 6379
  }
});
let redisConnectPromise = null;

redis.on('error', (err) => {
  console.error('Redis error', err)
});
redis.on('error', console.error);
redis.on('reconnecting', () => console.log('redis reconnecting'));


/**
 * EXPORTED ADAPTER METHODS
 */

SharedCacheServicePort.connectAdapter = async function () {
  if (redis.isOpen) return;

  if (!redisConnectPromise) {
    redisConnectPromise = redis.connect()
      .catch((error) => {
        redisConnectPromise = null;
        throw error;
      });
  }

  await redisConnectPromise;
};

SharedCacheServicePort.quitAdapter = async function () {
  if (!redis.isOpen) return;
  await redis.quit();
  redisConnectPromise = null;
};

SharedCacheServicePort.getAdapter = async function ({ key, defaultValue = null }) {
  return await redis.get(key) ?? defaultValue;
};

SharedCacheServicePort.setAdapter = async function ({ key, value, ttl }) {
  if (Number.isFinite(ttl) && ttl > 0) {
    return await redis.set(key, value, { PX: ttl });
  }
  return await redis.set(key, value);
};

SharedCacheServicePort.deleteAdapter = async function ({ key }) {
  return (await redis.del(key)) > 0;
};

SharedCacheServicePort.deleteByPrefixAdapter = async function ({ prefix }) {
  let removed = 0;
  for await (const keyChunk of redis.scanIterator({ MATCH: `${prefix}*` })) {
    const keys = Array.isArray(keyChunk) ? keyChunk : [keyChunk];
    for (const key of keys) {
      removed += await redis.del(key);
    }
  }
  return removed;
};

SharedCacheServicePort.hasAdapter = async function ({ key }) {
  return (await redis.exists(key)) == 1;
};

SharedCacheServicePort.appendListAdapter = async function ({ key, value }) { };

SharedCacheServicePort.getListAdapter = async function ({ key, value }) { };

module.exports = SharedCacheServicePort;
Object.freeze(SharedCacheServicePort);
