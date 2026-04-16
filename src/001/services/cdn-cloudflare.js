const YOUR_ZONE_ID = 'a589f4eee596860bded91504b3185b25'; // Replace with your Cloudflare Zone ID
const API_URL = `https://api.cloudflare.com/client/v4`;
const PURGE_API_URL = `${API_URL}/zones/{zone_id}/purge_cache`;
const RULE_API_URL = `${API_URL}/zones/{zone_id}/rulesets/{ruleset_id}/rules/{rule_id}`;

const fixed_urls = { };
const last_modified = { };
const last_modified_cachefile = global.path.resolve('./cache/last_modified.json');
const asset_folder = ["html","img","css","js","locale","sw"];
var root_folder = null;
var last_modified_changed = false;

const saveLastModified = async () =>{
	if(!last_modified_changed) return;
	if(await global.fileWriteAsync(last_modified_cachefile, JSON.stringify(last_modified), "utf8")){
		last_modified_changed = false;
		log("cf save");
	}else{
		log("cf save {FAILED}");
	}
}

const loadLastModified = async () =>{
	try{
		const data = JSON.parse(await global.fileReadAsync(last_modified_cachefile, "utf8", false));
		for(const i in data) last_modified[i] = data[i];
		log("cf load");
	}catch(e){
		log("cf load {FAILED} "+e);
	}
}

const updateRoot = async () => {
	console.log(`... Cloudflare Updating ROOTS`);

	root_folder = { };

	await loadLastModified();

	for(var host of global.config.domains){
		host = host.replace(/:[0-9]+/g,'');
		const folderPath = `${global.config.web_folder}/${host}`;
		try{
			const entries = await global.fsp.readdir(folderPath, { withFileTypes: true });
		    for(const entry of entries){
			  	if(!entry.isFile() && !entry.name.startsWith("_")) { //SUBDOMAINS IN FOLDERS
			  		const sub = entry.name;
			  		const dom = `${sub}.${host}`;
						const version = global.router.get_route_version(dom);

			  		if(!(dom in root_folder)) { root_folder[dom] = []; }
			  		root_folder[dom].push(entry.path); 

						fixed_urls[dom] = {global:[],html:[],sw:[]};
						fixed_urls[dom].global.push(`${dom}/cloud/`);
						fixed_urls[dom].global.push(`${dom}/robots.txt`);
						fixed_urls[dom].global.push(`${dom}/sitemap.xml`);
						fixed_urls[dom].sw.push(`${dom}/service-worker.js`);
						try{
							const lang_done = [];
							const route_config = await global.path.get_json_async(`${folderPath}/${sub}/${version}/_config.json`);
							for(const i in route_config.lang_country){ //EACH LANGUAGE
								const l = route_config.lang_country[i];
								if(lang_done.indexOf(l) > -1) { continue; }
								fixed_urls[dom].html.push(`${dom}/${l}.index.htm`);
								fixed_urls[dom].sw.push(`${dom}/${l}.manifest.json`);
								lang_done.push(l);
							}
						}catch(e){

						}
			  	}
			}
		}catch(e){
    		//console.error('... Error reading directory:'+folderPath);
		}
	}
}

module.exports.blockIPs = async function block(ips) {
  console.log(`... $ Cloudflare blocking ips`);

  const expression = ips.map(item => `(ip.src eq ${item})`).join(" or ");
  console.log(expression);

  for(const d in global.config.services.cdn.block_rule_id){
  	const zone = global.config.services.cdn.zone_id[d];
  	const rule = global.config.services.cdn.block_rule_id[d];
  	const ruleset = global.config.services.cdn.block_ruleset_id[d];

	  try {
	    const response = await fetch(RULE_API_URL
	    	.replace(/{zone_id}/g, zone)
	    	.replace(/{ruleset_id}/g, ruleset)
	    	.replace(/{rule_id}/g, rule), 
	  	{
	      method: 'PATCH',
	      headers: {
	        'Content-Type': 'application/json',
	        'Authorization': `Bearer ${global.config.services.cdn.api_key}`
	      },
	      body: JSON.stringify({
				  "enabled": true,
				  "action": "block",
				  "expression": expression,
				  "description": "Bloquear IPs Maliciosos",
				  "ref": rule
	      })
	    });

	    const data = await response.json();

	    if (response.ok) {
	      console.log('... Cloudflare blocking ips successful: '+d, data);
	    } else {
	      console.error('... Cloudflare blocking ips failed: '+d, data);
	    }
	  } catch (error) {
		    console.error('... Error blocking ips on Cloudflare: '+d, error);
	  }
	}
}

async function checkAssetFiles() {
	if(root_folder == null) { await updateRoot(); }

	var update_folders = {};
	for(const dom in root_folder){
	  console.log(`... Cloudflare CHECKING ${asset_folder.length} FOLDERS in ${dom}`);
		for(const f of asset_folder){
			const sub = dom.split('.')[0];
			const host = dom.replace(`${sub}.`,'');
			const version = global.router.get_route_version(dom);
			const update = await getFolderNeedsUpdate(`${root_folder[dom]}/${sub}/${version}/${f}`);
			if(update && update.length > 0){ 
				if(!(dom in update_folders)) {
					update_folders[dom] = { prefixes:[], zone_id:global.config.services.cdn.zone_id[host], rootpath: `${root_folder[dom]}/${sub}/${version}` };
				}
				for(const u of update){
					const p = `${dom}/assets/${u}`;
					if(update_folders[dom].prefixes.indexOf(p) == -1){
						update_folders[dom].prefixes.push(p); 
					}
				}
			}
		}
	}

	for(const dom in update_folders){
		await purgeCloudflareCache(
			update_folders[dom].prefixes,
			dom,
			update_folders[dom].rootpath,
			update_folders[dom].zone_id
		);
	}

	await saveLastModified();

	setTimeout(checkAssetFiles, global.config.services.cdn.check_interval);
}
module.exports.checkAssetFiles = checkAssetFiles;

const purgeCloudflareCache = async (prefixes = [], dom, rootpath, zone_id) => {
  if(prefixes.length == 0) { console.log(`... zero updates`); return; }

  console.log(`... $ Cloudflare Purging ${dom} ${prefixes.length} URLS ZONE ID: ${zone_id}`);

  const tags = [];
  for(const i in prefixes) { tags.push(prefixes[i].split("/").pop()); }
  global.router.cacheUUID(rootpath, tags);
	
	if(tags.indexOf("html") > -1) { prefixes = [...prefixes, ...fixed_urls[dom].html]; }
	if(tags.indexOf("sw") > -1) { prefixes = [...prefixes, ...fixed_urls[dom].sw]; }
	prefixes = [...prefixes, ...fixed_urls[dom].global];
  for(const i in prefixes) { console.log("... "+prefixes[i]); }

  try {
    const response = await fetch(PURGE_API_URL.replace(/{zone_id}/g,zone_id), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${global.config.services.cdn.api_key}`
      },
      body: JSON.stringify({
        prefixes: prefixes
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log('... Cloudflare cache purge successful:', data);

      //FETCH FOR ACCELERATED CACHE -> if server in brazil
      /*for(const i of fixed_urls){
      	const r = await fetch(`https://${i}`);
      	if(r.ok) { console.log("... fetched ", i); }
      	else{ console.log("... NOT fetched ", i); }
      }*/
    } else {
      console.error('... Cloudflare cache purge failed:', data);
    }
  } catch (error) {
    console.error('... Error purging Cloudflare cache:', error);
  }
}

const getFolderNeedsUpdate = async (folderPath) => {
  try {
  	const modified = [];
  	const folder_name = folderPath.split("/").pop();
    const entries = await global.fsp.readdir(folderPath, { withFileTypes: true });
    for(const entry of entries){
	  	if(!entry.isFile()) continue;
	  	const file = `${entry.path}/${entry.name}`;
			const stat = await global.fileStatAsync(file);
			const d = stat.mtime;
			if(!(file in last_modified) || d.getTime() > last_modified[file]){
				last_modified[file] = d.getTime();
				last_modified_changed = true;
				if((entry.name).startsWith('inline')) { 
					if(modified.indexOf('html') == -1){ modified.push('html'); } 
				} else if(modified.indexOf(folder_name) == -1) { modified.push(folder_name); }
				
			}
	  }
		return modified;
	} catch (err) {
    //console.error('... Error reading directory:'+folderPath);
    return null;
  }
}

/*

PATCH

https://api.cloudflare.com/client/v4
zones/${zone_id}/
rulesets/28ba59917885453a83eccf17fbe02a04/
rules/ac45b659bb5a4cc1a4d3fe5b4b1c8e77

{
  "action": "block",
  "description": "Bloquear IPs Maliciosos",
  "enabled": true,
  "expression": "(ip.src eq 4.197.248.250) or (ip.src eq 68.218.100.126)",
  "ref": "ac45b659bb5a4cc1a4d3fe5b4b1c8e77"
}

*/