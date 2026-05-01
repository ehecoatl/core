'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const {
  normalizeRouteCachePolicy,
  clampRouteCacheTtl
} = require(`@/utils/http/route-cache-policy`);

test(`normalizeRouteCachePolicy maps numeric route cache values to public max-age seconds`, () => {
  assert.deepEqual(normalizeRouteCachePolicy(60), {
    cacheControl: `public, max-age=60`,
    internalTtlMs: 60000,
    explicitlyDisabled: false
  });
});

test(`normalizeRouteCachePolicy preserves no-cache routes`, () => {
  assert.deepEqual(normalizeRouteCachePolicy(`no-cache`), {
    cacheControl: `no-cache`,
    internalTtlMs: null,
    explicitlyDisabled: true
  });
});

test(`normalizeRouteCachePolicy infers ttl from cache-control strings`, () => {
  assert.deepEqual(
    normalizeRouteCachePolicy(`public, max-age=60, s-maxage=120, stale-while-revalidate=30`),
    {
      cacheControl: `public, max-age=60, s-maxage=120, stale-while-revalidate=30`,
      internalTtlMs: 120000,
      explicitlyDisabled: false
    }
  );
});

test(`clampRouteCacheTtl applies maxResponseCacheTTL in seconds`, () => {
  const policy = normalizeRouteCachePolicy(60);
  assert.equal(clampRouteCacheTtl(policy, 5), 5000);
});
