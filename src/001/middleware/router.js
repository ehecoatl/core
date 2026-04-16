//global.sudo = global.sudo ?? require('sudo-prompt');
//global.genuuid = global.genuuid??require('uuid').v4;
//global.importFresh = global.importFresh ?? require('import-fresh');

const Controllers = {};

const router_uuid = require('./router-uuid.js');
const router_domain = require('./router-domain.js');
const routerRegExpCheck = require("./router-regexp.js");

global.limiter = require('./router-limiter.js');
global.sessions = require('./router-sessions.js');
global.cache = require('./router-cache.js');

module.exports.setupExpressServer = require("./router-setup.js");

exports.Routes = {};

exports.get_route_version = function (label) { return global.config.route_version[label] ?? global.config.route_version.default };

exports.loadDomains = async () => {
  try{
    global.config.domains = [];
    global.config.alias_domains = {list:[]};
    const entries = await global.fsp.readdir(global.config.web_folder, { withFileTypes: true });
    console.log("Allowed Domains:");
    for(const entry of entries) { 
    	if(!entry.isFile()){
    		console.log(`- ${entry.name}`);
    		global.config.domains.push(`${entry.name}`);
	    	await global.folderCreateAsync(
	    		`${global.config.web_folder}/${entry.name}/_log`,
	    		`${global.config.web_folder}/${entry.name}/_sessions`
	    	);
	    }else{
	    	console.log(`- ALIAS: ${entry.name}`);
	    	global.config.alias_domains.list.push(entry.name);
	    	global.config.alias_domains[entry.name] = await global.path.get_json_async(`${global.config.web_folder}/${entry.name}`);
	    }
    }
  }catch(e){
    console.error("DOMAINS NOT LOADED");
    throw e;
  }
}

exports.redirect = function (req, res, r = { redirect: 302, to: "/" }){
	r.to = r.to.replaceAll("{lang}", req.lang);
	r.redirect = parseInt(r.redirect);

	try{
    switch(r.redirect){
      case 0:
        req._host = r.to;
        break;
      
      case 301:
      case 302:
      	res.redirect(r.redirect, `${r.to}`);
        break;

      default:
  			global.default404(req, res, `INVALID REDIRECT VALUE 301 / 302 / 000 are allowed`); 
      	break;
    }
  }catch(e){
  	global.default404(req, res, `INVALID REDIRECT ${JSON.stringify(r)} - ${e}`);  
  	return true;
  }
  return r.redirect != 0;
}

exports.mid_router = async function mid_router(req, res, next){
  const host = req.get('host');

  req.noQueryUrl = req.url.replace(/\?.*$/, "");
  log(`~~ ${req.method} ${host}${req.noQueryUrl}`);

  if(await router_domain(req, res)
  || await global.limiter.checkBlock(req,res)
  || await router_uuid(req, res, `${req.root_path}`)) return;

  global.applogger(`${req.method} ${host}${req.originalUrl}`, 'access', req);

  next();
};

global.default404 = async (req, res, message = "") =>{
	global.cache.setCacheForever(res);
	res.status(404).end();

	console.error(`E-> 404 -> ${req.get('host')}${req.noQueryUrl} : ${message}`);
	global.applogger(`${req.get('host')}${req.originalUrl} : ${message}`, '404', req);
	
	global.limiter.blockAccess(req, res);
}

global.default403 = async (req, res, message = "") =>{
	console.error(`E-> 403 -> ${req.noQueryUrl} : ${message}`);
	res.status(403).end();
}

exports.validDomain = function (domain){ return global.config.domains.find((u) => domain.includes(u.replace(/:[0-9]+/g,''))); }
exports.validAlias = function (alias_domain){ return global.config.alias_domains.list.find((u) => alias_domain.includes(u.replace(/:[0-9]+/g,''))); }
exports.validAny = function (alias_domain){ return validDomain(alias_domain) ?? validAlias(alias_domain) ?? null; }

async function treatRequest(controller, call, req, res){
	const path = req.root_path;
	const base_controller_path = `${path}/_Controller.js`;
	const Routes = this.Routes;
	var controller_path = `${path}/${controller}Controller.js`;

	//ROUTING BY JSON EXCEPTIONS
	if(!(path in Routes)) { 
		try{
			Routes[path] = await global.fileReadAsync(global.path.resolve(`${path}/_config.json`));
			if(Routes[path] != false) {
				Routes[path] = JSON5.parse(Routes[path]).routes_available; 
				Routes[path].all = Object.keys(Routes[path]);
			}
		}catch(e){
			console.error(e);
			res.status(500).end(); return;
		}
	}

	if(Routes[path] == false) { return global.default404(req, res, "NO ROUTES JSON FILE FOR THIS DOMAIN"); }

	if(r = routerRegExpCheck(req, path, Routes[path].all)) {
		if("redirect" in r) { return await global.router.redirect(req, res, r); }
		else if("asset" in r) { return await global.responser.builder.genServeRoute(req, res, r); }
		else{
			if("controller" in r) { controller_path = `${path}/${r.controller}`; }
			if("call" in r) { call = r.call; }
		}
	}else{
		return global.default404(req, res, "NO ROUTE FOUND");
	}

	if(!(base_controller_path in Controllers)) { 
		try{
			let exists = await global.fileExistsAsync(global.path.resolve(base_controller_path));
			if(exists) { Controllers[base_controller_path] = require(global.path.resolve(base_controller_path)); } //global.importFresh
		}catch(e){
			console.error(e);
			res.status(500).end(); return;
		}
	}

	if(!(controller_path in Controllers)) { 
		try{
			let exists = await global.fileExistsAsync(global.path.resolve(controller_path));
			if(!exists) { return global.default404(req, res, "CONTROLLER "+controller_path+" DOESNT EXIST"); }
			Controllers[controller_path] = require(global.path.resolve(controller_path));
		}catch(e){
			return global.default404(req, res, "CONTROLLER "+controller_path+" ERROR"+e);
		}

		try{
			if(Controllers[base_controller_path] &&
				typeof Controllers[controller_path].setBase == "function"){
				Controllers[controller_path].setBase(Controllers[base_controller_path]);
			}
		}catch(e){
			console.error(e);
			res.status(500).end(); return;
		}
	}

	try{
		const instance = Controllers[controller_path];
		if (!call || call.length == 0) { 
			if(!("index" in instance)) { return global.default404(req, res, "CALL index DOESNT EXIST"); }
			else { await instance.index(req, res); }
		}
		else if (call in instance) { await instance[call](req, res); }
		else if ("index" in instance) { await instance.index(req, res); }
		else { return global.default404(req, res, "CALL "+call+" or INDEX DOESNT EXIST"); }
	}catch(e){
		console.error(e);
		res.status(500).end();
		return;
	}
}
exports.treatRequest = treatRequest;

exports.cacheUUID = async (rootpath, update_tag=null) => { //router_uuid | serivces_cloudflare | responser_builder
  var fileContent = await global.fileReadAsync(global.path.resolve(`${rootpath}/uuid`));
  var changed = false;
  if(!fileContent){//generate new uuid
    fileContent = JSON.stringify({
      "js": global.genuuid(),
      "sw": global.genuuid(),
      "img": global.genuuid(),
      "css": global.genuuid(),
      "html": global.genuuid(),
      "models": global.genuuid(),
      "locale": global.genuuid()
    });
    changed = true;
  }else if(update_tag){
    fileContent = JSON.parse(fileContent);
    if(typeof update_tag == "string"){
      fileContent[update_tag] = global.genuuid();
    }else{
      for(const i of update_tag) { fileContent[i] = global.genuuid(); }
    }
    fileContent = JSON.stringify(fileContent);
    changed = true;
    global.log(`CACHE UUID UPDATED FOR ${typeof update_tag == "string" ? update_tag : update_tag.join(',')}`);
  }

  if(changed){
    await global.fileWriteAsync(
      global.path.resolve(`${rootpath}/uuid`),
      fileContent
    );
  }

  return fileContent;
}