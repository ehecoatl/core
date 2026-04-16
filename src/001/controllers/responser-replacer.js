	(()=>{
		'use strict';

		const ___map = new Map();
		const ___esc = s => s.replace(/[.*+?^${}()[\]\\]/g, "\\$&");
		const __global=typeof exports !== "undefined" ? exports
						:typeof globalThis !== "undefined" ? globalThis
						:typeof global !== "undefined" ? global
						:typeof window !== "undefined" ? window
						:typeof self !== "undefined" ? self
						:this;

		__global.Replacer = {

			replaceOneShot(str, pairs_map, key_mask="?", replace_mask="?") {
				return this.compile(pairs_map, key_mask, replace_mask, str)
			},

			compile(pairs_map, key_mask="?", replace_mask="?", ...args) {
			  if (!pairs_map || typeof pairs_map !== "object") {
			  	console.error("[Replacer.compile] WARNING: Invalid pair map");
			  	return (ctx => ctx);
			  }

			  if (!key_mask || !replace_mask || typeof key_mask !== "string" || typeof replace_mask !== "string" 
			  	|| key_mask.length <= 0 || replace_mask.length <= 0) {
			  	console.error("[Replacer.compile] WARNING: Invalid replace_mask or key_mask");
			  	return (ctx => ctx);
				}
			  
			  const oneshotString = args.length > 0 ? args[0] : null;
			  if(typeof oneshotString !== "string" && oneshotString !== null) {
			  	console.error("[Replacer.compile] WARNING: Invalid oneshotString");
			  	return (ctx => ctx);
			  }

			  const keys = Object.keys(pairs_map);
			  if (keys.length === 0) {
			  	console.error("[Replacer.compile] WARNING: Empty pair map");
			  	return oneshotString ? oneshotString : (ctx => ctx);
			  }

			  ___map.clear();

			  if(key_mask == "?" && replace_mask == "?"){
			  	for (let i = 0; i < keys.length; i++) ___map.set(keys[i], pairs_map[keys[i]]);
			  }else{
				  for (let i = 0; i < keys.length; i++) {
				    const k = keys[i];
				    const token = key_mask.includes("?") ? key_mask.replaceAll("?", k) : k;
				    ___map.set(token, replace_mask.includes("?") ? replace_mask.replaceAll("?", pairs_map[k]) : pairs_map[k]);
				  }
				}

			  const regex = new RegExp(
			    keys.map(k =>
			        ___esc( key_mask.includes("?") ? key_mask.replaceAll("?", k) : k )
			      ).join("|"),
			    "g"
			  );

			  if(oneshotString) { return oneshotString.replace(regex, (m => ___map.get(m))); }

			  const __map = Object.fromEntries(___map);
			  return ctx => ctx.replace(regex, (m => __map[m]));
			},

			replace(str, precompiled_map) {
			  if (!str || typeof str !== "string" || str.length <= 0){
			  	console.error("[Replacer.replace] Invalid string input");
					return str;
			  } 

			  if(typeof precompiled_map !== "function"){
			  	console.error("[Replacer.replace] Invalid precompiled_map");
					return str;
			  }

			  return precompiled_map(str);
			}
		};
	})();