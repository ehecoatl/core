// adapters/shared/shared-cache-service/local-memory.js


'use strict';


const SharedCacheServicePort = require(`@/_core/_ports/outbound/shared-cache-service-port`);

const cache = new Map();
const now = () => Date.now();

SharedCacheServicePort.connectAdapter = async function () { };
SharedCacheServicePort.quitAdapter = async function () { };

SharedCacheServicePort.getAdapter = async function ({ key, defaultValue = null }) {
  const record = getRecord(key);
  return record ? record.value : defaultValue;
};

SharedCacheServicePort.setAdapter = async function ({ key, value, ttl }) {
  cache.set(key, {
    value,
    expiresAt: resolveExpiry(ttl)
  });
  return true;
};

SharedCacheServicePort.deleteAdapter = async function ({ key }) {
  return cache.delete(key);
};

SharedCacheServicePort.deleteByPrefixAdapter = async function ({ prefix }) {
  let removed = 0;
  for (const key of [...cache.keys()]) {
    const record = purgeExpired(key);
    if (!record) continue;
    if (!key.startsWith(prefix)) continue;
    cache.delete(key);
    removed += 1;
  }
  return removed;
};

SharedCacheServicePort.hasAdapter = async function ({ key }) {
  return getRecord(key) !== null;
};

SharedCacheServicePort.appendListAdapter = async function ({ key, value }) {
  const record = getRecord(key);
  const list = Array.isArray(record?.value) ? [...record.value] : [];
  list.push(value);
  cache.set(key, {
    value: list,
    expiresAt: record?.expiresAt ?? null
  });
  return true;
};

SharedCacheServicePort.getListAdapter = async function ({ key }) {
  const record = getRecord(key);
  return Array.isArray(record?.value) ? record.value : [];
};

function resolveExpiry(ttl) {
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  return now() + ttl;
}

function purgeExpired(key) {
  const record = cache.get(key);
  if (!record) return null;
  if (record.expiresAt != null && record.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return record;
}

function getRecord(key) {
  return purgeExpired(key);
}

module.exports = SharedCacheServicePort;
Object.freeze(SharedCacheServicePort);
