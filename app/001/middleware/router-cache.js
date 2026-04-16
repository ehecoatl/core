global.genuuid = global.genuuid??require('uuid').v4;

const cache_queue = {};
setInterval(async () => {
	for(const host in cache_queue){
		const filename = global.cache_path_resolve(`cached_${host}.json`);
		console.log(`%% ${filename}`);
		await global.fileAppendLineAsync(filename, cache_queue[host]);
		delete cache_queue[host];
	}
}, global.config.domain_log_interval??3000);

module.exports = {
	setNoCache: (res) => ("cache_set" in res) || (res.setHeader("Cache-Control", "no-cache") && (res.cache_set = true)),
	setCacheForever: (res) => ("cache_set" in res) || (global.cache.setCache(res, 31536000, 31536000, "immutable") && (res.cache_set = true)),
	setCache: (res,  browser_ttl=60, cdn_ttl=null, add=null) => {
		if(! ("cache_set" in res) ) return true;
		res.setHeader("Cache-Control", `${cdn_ttl?`public, s-maxage=${cdn_ttl},`:`private,`} max-age=${browser_ttl}, stale-while-revalidate=${browser_ttl}, stale-if-error=${browser_ttl} ${add?`,${add}`:''}`);
		res.cache_set = true;
		
		console.log(`%% CACHED`);

		/* keep cache URL record in cache folder */
		const date_system = global.date_system();
		cache_queue[res._host] = `${(cache_queue[res._host]??"")}>${res.noQueryUrl}\n[${date_system}] ${res.get("Cache-Control")}<\n`;
	},

	setCacheHeader: (res, header) => {
		if(! ("cache_set" in res) ) return true;
		res.setHeader("Cache-Control", header);
		res.cache_set = true;
	},

	setDefaultCache: (res) => {
		if(! ("cache_set" in res) ) return true;
		const smaxage = global.config.cdn_cache_seconds; //TTL CDN
		const bmaxage = global.config.browser_cache_seconds; //TTL Browser
		global.cache.setCache(res, bmaxage, smaxage);
		res.cache_set = true;
	},
};