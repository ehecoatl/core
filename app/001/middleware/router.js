//global.sudo = global.sudo ?? require('sudo-prompt');
//global.genuuid = global.genuuid??require('uuid').v4;
//global.importFresh = global.importFresh ?? require('import-fresh');

const Controllers = {};

const router_domain = require('./router-domain.js');
const routerRegExpCheck = require("./router-find-match.js");

global.limiter = require('./router-limiter.js');
global.cache = require('./router-cache.js');

module.exports.sessions = require('./router-sessions.js');
module.exports.setupExpressServer = require("./router-setup.js");

exports.Routes = {};

exports.get_route_version = function (label) { 
	try{
		global.config.route_version = global.config.route_version ?? {};
		if(label in global.config.route_version) { return global.config.route_version[label]; }

		const c = global.path.get_json(`${label}/_config.json`);
		global.config.route_version[label] = c.default_version;

		return global.config.route_version[label] 
	}catch(e){
		return global.config.route_version_default;
	}
};

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
  req.queryUrl = req.url.replace(/^.*\?/, "");
  log(`~~ ${req.method} ${host}${req.noQueryUrl}`);

  if(await router_domain(req, res)
  || await global.limiter.checkBlock(req,res)) return;

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

module.exports.treatRequest = async function (controller, call, req, res){
	const path = req.root_path;
	const root_controller_path = `${path}/controllers/_rootController.js`;
	const config_path = `${path}/_config.json`;
	const Routes = this.Routes;

	var config_stat = await global.fileStatAsync(config_path, false);
	var controller_path = `${path}/controllers/${controller}Controller.js`;

	//ROUTING BY JSON EXCEPTIONS
	if(!(path in Routes)) { 
		try{
			Routes[path] = await global.fileReadAsync(config_path, "utf8", false);
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

	if(r = await routerRegExpCheck(req, path, Routes[path].all, config_stat.mtime)) {
	  req.route_data = r;

		if("cache" in r) { global.cache.setCacheHeader(res, r.cache); }

		if("redirect" in r) { return await global.router.redirect(req, res, r); }
		else if("asset" in r) { return await global.responser.builder.genServeRoute(req, res, r); }
		else{
			if("controller" in r) { controller_path = `${path}/${r.controller}`; }
			if("call" in r) { call = r.call; }
		}
	  if("session" in r) {
	  	const session_built = await new Promise((resolve) => this.sessions.builder(req, res, resolve) ); 
	  	if(session_built === false) return;
	  }
	}else{
		return global.default404(req, res, "NO ROUTE FOUND");
	}

	if(!(controller_path in Controllers)) { 
		try{
			let exists = await global.fileExistsAsync(global.path.resolve(controller_path));
			if(!exists) { return global.default404(req, res, "CONTROLLER "+controller_path+" DOESNT EXIST"); }
			Controllers[controller_path] = require(global.path.resolve(controller_path));
		}catch(e){
			return global.default404(req, res, "CONTROLLER "+controller_path+" ERROR"+e);
		}
	}

	const instance = Controllers[controller_path];

	if(typeof instance.root !== "object") { 
		if(!(root_controller_path in Controllers)){
			try{
				let exists = await global.fileExistsAsync(global.path.resolve(root_controller_path));
				Controllers[root_controller_path] = require(global.path.resolve(root_controller_path)); //global.importFresh
			}catch(e){
				console.error(e);
				res.status(500).end(); return;
			}
		}
		const v = {
		  value: Controllers[root_controller_path],
		  writable: false,      // Prevents modification of the value
		  enumerable: true,     // Allows the property to be iterated over (optional, default is false)
		  configurable: false   // Prevents the property from being deleted or reconfigured (optional, default is false)
		};
		Object.defineProperty(instance, 'root', v);
	}

	try{
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