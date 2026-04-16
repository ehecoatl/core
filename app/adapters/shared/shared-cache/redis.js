// adapters/shared/shared-cache/redis.js


'use strict';


const SharedCacheServiceAdapter = require(`g@/shared/shared-cache/shared-cache-service-adapter`);
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

SharedCacheServiceAdapter.connectAdapter = async function () {
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

SharedCacheServiceAdapter.quitAdapter = async function () {
  if (!redis.isOpen) return;
  await redis.quit();
  redisConnectPromise = null;
};

SharedCacheServiceAdapter.getAdapter = async function ({ key, defaultValue = null }) {
  return await redis.get(key) ?? defaultValue;
};

SharedCacheServiceAdapter.setAdapter = async function ({ key, value, ttl }) {
  if (Number.isFinite(ttl) && ttl > 0) {
    return await redis.set(key, value, { PX: ttl });
  }
  return await redis.set(key, value);
};

SharedCacheServiceAdapter.deleteAdapter = async function ({ key }) {
  return (await redis.del(key)) > 0;
};

SharedCacheServiceAdapter.deleteByPrefixAdapter = async function ({ prefix }) {
  let removed = 0;
  for await (const keyChunk of redis.scanIterator({ MATCH: `${prefix}*` })) {
    const keys = Array.isArray(keyChunk) ? keyChunk : [keyChunk];
    for (const key of keys) {
      removed += await redis.del(key);
    }
  }
  return removed;
};

SharedCacheServiceAdapter.hasAdapter = async function ({ key }) {
  return (await redis.exists(key)) == 1;
};

SharedCacheServiceAdapter.appendListAdapter = async function ({ key, value }) { };

SharedCacheServiceAdapter.getListAdapter = async function ({ key, value }) { };

module.exports = SharedCacheServiceAdapter;
Object.freeze(SharedCacheServiceAdapter);
