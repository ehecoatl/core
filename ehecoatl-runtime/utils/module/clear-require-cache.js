'use strict';

const path = require(`node:path`);
const weakRequire = require(`./weak-require`);

function clearRequireCache({ preserve = [] } = {}) {
  weakRequire.clearAll?.();

  const cacheKeys = Object.keys(require.cache);
  const preservedKeys = resolvePreserveKeys(preserve);
  let clearedCount = 0;
  let preservedCount = 0;

  for (const cacheKey of cacheKeys) {
    if (preservedKeys.has(cacheKey)) {
      preservedCount += 1;
      continue;
    }

    delete require.cache[cacheKey];
    clearedCount += 1;
  }

  return Object.freeze({
    clearedCount,
    preservedCount
  });
}

function resolvePreserveKeys(preserve = []) {
  const resolvedKeys = new Set();

  for (const entry of Array.isArray(preserve) ? preserve : []) {
    const normalizedEntry = typeof entry === `string`
      ? entry.trim()
      : ``;
    if (!normalizedEntry) continue;

    const absolutePath = path.resolve(normalizedEntry);
    resolvedKeys.add(absolutePath);

    try {
      resolvedKeys.add(require.resolve(normalizedEntry));
    } catch {
    }
  }

  return resolvedKeys;
}

module.exports = clearRequireCache;
Object.freeze(module.exports);
