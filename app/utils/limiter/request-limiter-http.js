// utils/limiter/request-limiter-http.js


'use strict';


const {
  corkIfAvailable,
  writeUwsResponseHead
} = require(`@/utils/http/http-response-write`);


/**
 * 
 * @param {{
 * capacity:number,
 * refillRateSeconds:number
 * }} options 
 * @returns 
 */
module.exports = function createTokenBucketLimiter(options) {

  const {
    capacity = 20,                // max tokens in bucket
    refillRateSeconds = 10,              // tokens per second
  } = options;

  const buckets = new Map();

  return async function tokenBucketLimiter(key, res, next) {

    const now = Date.now();

    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefill: now
      };
      buckets.set(key, bucket);
    }

    const elapsed = (now - bucket.lastRefill) / 1000;
    const refill = elapsed * refillRateSeconds;

    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      if (typeof res.writeStatus === `function`) {
        corkIfAvailable(res, () => {
          writeUwsResponseHead(res, {
            status: 429,
            headers: {
              'Content-Type': `text/plain; charset=utf-8`
            }
          });
          res.end(`Too Many Requests`);
        });
      } else {
        res.statusCode = 429;
        if (typeof res.setHeader === `function`) {
          res.setHeader(`Content-Type`, `text/plain; charset=utf-8`);
        }
        res.end(`Too Many Requests`);
      }

      return;
    }

    bucket.tokens -= 1;

    if (next) await next();
  };
};

/**

const http = require('http');
const limiter = require('./token-bucket');

const rateLimiter = limiter({
  capacity: 20,
  refillRate: 5
});

http.createServer((req, res) => {

  rateLimiter(req, res, () => {

    res.end("ok");

  });

}).listen(3000);

 */
