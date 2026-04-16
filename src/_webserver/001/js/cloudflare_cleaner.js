const YOUR_API_KEY = 'kmHEul8A0tERhOpBv2Kq31LLGqCIDHNrmodnefLW'; // Replace with your actual Cloudflare API Key
const YOUR_ZONE_ID = 'a589f4eee596860bded91504b3185b25'; // Replace with your Cloudflare Zone ID
const PURGE_API_URL = `https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache`;

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
		const folderPath = global.path.resolve(`./src/${host}`);
		try{
			const entries = await global.fsp.readdir(folderPath, { withFileTypes: true });
		    for(const entry of entries){
			  	if(!entry.isFile()) { //SUBDOMAINS IN FOLDERS
			  		const dom = `${entry.name}.${host}`;

			  		if(!(dom in root_folder)) { root_folder[dom] = []; }
			  		root_folder[dom].push(entry.path); 

						fixed_urls[dom] = {global:[],html:[],sw:[]};
						fixed_urls[dom].global.push(`${dom}/cloud/`);
						fixed_urls[dom].global.push(`${dom}/robots.txt`);
						fixed_urls[dom].global.push(`${dom}/sitemap.xml`);
						fixed_urls[dom].sw.push(`${dom}/service-worker.js`);
						const lang_done = [];
						for(const i in global.config.lang_country){ //EACH LANGUAGE
							const l = global.config.lang_country[i];
							if(lang_done.indexOf(l) > -1) { continue; }
							fixed_urls[dom].html.push(`${dom}/${l}.index.htm`);
							fixed_urls[dom].sw.push(`${dom}/${l}.manifest.json`);
							lang_done.push(l);
						}
			  	}
			}
		}catch(e){
    		//console.error('... Error reading directory:'+folderPath);
		}
	}
}

global.cloudflareCheckAssetFiles = async () => {
	if(root_folder == null) { await updateRoot(); }

	var update_folders = {};
	for(const dom in root_folder){
	  console.log(`... Cloudflare CHECKING ${asset_folder.length} FOLDERS in ${dom}`);
		for(const f of asset_folder){
			const sub = dom.split('.')[0];
			const host = dom.replace(`${sub}.`,'');
			const version = global.get_route(dom);
			const update = await getFolderNeedsUpdate(`${root_folder[dom]}/${sub}/${version}/${f}`);
			if(update && update.length > 0){ 
				if(!(dom in update_folders)) {
					update_folders[dom] = { prefixes:[], zone_id:global.config.cf_zone_id[host], rootpath: `${root_folder[dom]}/${sub}/${version}` };
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
		await global.purgeCloudflareCache(
			update_folders[dom].prefixes,
			dom,
			update_folders[dom].rootpath,
			update_folders[dom].zone_id
		);
	}

	await saveLastModified();

	setTimeout(global.cloudflareCheckAssetFiles, 30*1000);
}

global.purgeCloudflareCache = async (prefixes = [], dom, rootpath, zone_id) => {
  if(prefixes.length == 0) { console.log(`... zero updates`); return; }

  console.log(`... $ Cloudflare Purging ${dom} ${prefixes.length} URLS ZONE ID: ${zone_id}`);

  const tags = [];
  for(const i in prefixes) { tags.push(prefixes[i].split("/").pop()); }
  global.cacheUUID(rootpath, tags);
	
	if(tags.indexOf("html") > -1) { prefixes = [...prefixes, ...fixed_urls[dom].html]; }
	if(tags.indexOf("sw") > -1) { prefixes = [...prefixes, ...fixed_urls[dom].sw]; }
	prefixes = [...prefixes, ...fixed_urls[dom].global];
  for(const i in prefixes) { console.log("... "+prefixes[i]); }

  try {
    const response = await fetch(PURGE_API_URL.replace(/{zone_id}/g,zone_id), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${YOUR_API_KEY}`
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