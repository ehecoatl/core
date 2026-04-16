const ___esc = s => s.replaceAll(/[\.]/g, "\\$&").replaceAll("*",".*");
const ___vars_regex = /\{[a-z0-9-_]+\}/gi;
const ___rep_regex = "([a-zA-Z0-9-_%~\\.]+)";

function routerRegExp(req, root_path, all) {
	const route = req.noQueryUrl;
	var route_found = null;

	all.find((u) => {
		const _var_keys = u.match(___vars_regex);
		if(!_var_keys || _var_keys.length === 0){
			if(u == route) {
				const route_data = {...global.router.Routes[root_path][u]};
				for(const i in route_data){
					if(Array.isArray(route_data[i])) { route_data[i] = route_data[i].map((val) => val.replace("{lang}", req.lang)); }
					else if(typeof route_data[i] === "string") { route_data[i] = route_data[i].replaceAll("{lang}", req.lang); }
				}
				route_found = route_data;
				return true;
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

			console.log("----");
			console.log(JSON.stringify(rep_data, null, 2));
			console.log("----");

			const Replacer = global.responser.Replacer;
			const comp = Replacer.compile(rep_data, "?");
			const rep = (s) => Replacer.replace(s, comp);
			for(const i in route_data){
				if(Array.isArray(route_data[i])) { route_data[i] = route_data[i].map((val) => rep(val)); }
				else if(typeof route_data[i] === "string") { route_data[i] = rep(route_data[i]); }
			}
			route_found = route_data;

			console.log(`% ROUTE FOUND FOR ${route} ===> ${u}`);
		}

		return route_found ? true : false;
	});

	return route_found;
}

module.exports = routerRegExp;