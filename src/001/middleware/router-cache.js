global.genuuid = global.genuuid??require('uuid').v4;

module.exports = {
	setNoCache: (res) => res.setHeader("Cache-Control", "no-cache"),
	setCacheForever: (res) => global.cache.setCache(res, 31536000, 31536000, "immutable"),
	setCache: (res,  browser_ttl=60, cdn_ttl=null, add=null) => {
		res.setHeader("Cache-Control", `${cdn_ttl?`public, s-maxage=${cdn_ttl},`:`private,`} max-age=${browser_ttl}, stale-while-revalidate=${browser_ttl}, stale-if-error=${browser_ttl} ${add?`,${add}`:''}`);
	},

	setDefaultCache: (res) => {
		const smaxage = global.config.cdn_cache_seconds; //TTL CDN
		const bmaxage = global.config.browser_cache_seconds; //TTL Browser
		global.cache.setCache(res, bmaxage, smaxage);
	},
};