const ___esc = s => s.replaceAll(/[\.]/g, "\\$&").replaceAll("*",".*");
const ___vars_regex = /\{[a-z0-9-_]+\}/gi;
const ___rep_regex = "([a-zA-Z0-9-_%~\\.]+)";

const routes_cache_filename = "routes_cache";

const cached_routes = {};
const cached_routes_last_modified = {};
const cached_routes_changed = [];

setInterval(async ()=>{
	while(cached_routes_changed.length > 0){
		const r = cached_routes_changed.pop();
		if(r) { await writeToRouteCache(r, cached_routes[r]); }
	}
},10000);

async function writeToRouteCache(r, data){
	return await global.fileWriteAsync(`${r}/${routes_cache_filename}`, JSON.stringify(data, null, 2));
}

/* TODO CACHED ROUTING RESULTS */
async function checkCache(root_path, uri, all, last_modified_config_json){
	if(!(root_path in cached_routes)){
		try { 
			cached_routes[root_path] = await global.path.get_json_async(`${root_path}/${routes_cache_filename}`);
			cached_routes_last_modified[root_path] = (await global.fileStatAsync(`${root_path}/${routes_cache_filename}`, "utf8", false)).mtime;
		}
		catch(e) { cached_routes[root_path] = {}; }
	}

	// ClearCache
	if(last_modified_config_json > cached_routes_last_modified[root_path]){ 
		cached_routes[root_path] = {};
		cached_routes_last_modified[root_path] = last_modified_config_json;
		await writeToRouteCache(root_path, {});
	}
	
	if((uri in cached_routes[root_path]) &&
		cached_routes[root_path][uri] in all ) { return all[cached_routes[root_path][uri]]; }
	else { return null; }
}

function cacheResult(root_path, uri, route_match){
	if(!route_match) { return false; }
	cached_routes[root_path][uri] = route_match;
	cached_routes_changed.push(root_path);
	return true;
}

module.exports = async function (req, root_path, all, last_modified_config_json) {
	const route = req.noQueryUrl;
	var route_found = await checkCache(root_path, route, all, last_modified_config_json);

	all.find((u) => {
		const _var_keys = u.match(___vars_regex);

		if(!_var_keys || _var_keys.length === 0){
			if(u == route) {
				// LITERAL ROUTES W/O PARAMS
				const route_data = {...global.router.Routes[root_path][u]};
				for(const i in route_data){
					if(Array.isArray(route_data[i])) { route_data[i] = route_data[i].map((val) => val.replace("{lang}", req.lang)); }
					else if(typeof route_data[i] === "string") { route_data[i] = route_data[i].replaceAll("{lang}", req.lang); }
				}
				route_found = route_data;
				return cacheResult(root_path, route, u);
			}
			return false;
		}

		const source = `^${___esc(u).replace(___vars_regex, ___rep_regex)}$`;
		const regexp = new RegExp(source,"gi");
		const values = Array.from(route.matchAll(regexp));

		if( values.length > 0 ){
			const _var_values = [];
			for (let m=0, x=values.length;m<x;m++)
				for(let i=1, l=values[m].length;i<l;i++)
					_var_values.push(values[m][i]);

			const route_data = {...global.router.Routes[root_path][u]};
			const rep_data = Object.fromEntries(_var_keys.map((key, index) => [key, _var_values[index]]));
			for(const i in rep_data){
				if(!(i in route_data)) continue; 
				else if(!(new RegExp(route_data[i],"gi")).test(rep_data[i])){
					console.log(`% INVALID ${i} VALUE ${rep_data[i]}`);
					return false;
				}
			}

			rep_data["{full_uri}"] = req.noQueryUrl;

			//console.log("----");
			//console.log(JSON.stringify(rep_data, null, 2));
			//console.log("----");

			const Replacer = global.responser.Replacer;
			const comp = Replacer.compile(rep_data, "?");
			const rep = (s) => Replacer.replace(s, comp);
			for(const i in route_data){
				if(Array.isArray(route_data[i])) { route_data[i] = route_data[i].map((val) => rep(val)); }
				else if(typeof route_data[i] === "string") { route_data[i] = rep(route_data[i]); }
			}
			route_found = route_data;

			//console.log(`% ROUTE FOUND FOR ${route} ===> ${u}`);
		}

		return cacheResult(root_path, route, route_found ? u : false);
	});

	return route_found;
}