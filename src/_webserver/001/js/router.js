const Controllers = {};
const Routes = {};

async function treatRequest(controller, call, req, res){
	const path = req.root_path;
	const base_controller_path = `${path}/_Controller.js`;
	var controller_path = `${path}/${controller}Controller.js`;

	//ROUTING BY JSON EXCEPTIONS
	if(!(path in Routes)) { 
		try{
			Routes[path] = await global.fileReadAsync(global.path.resolve(`${path}/routes.json`));
			if(Routes[path] != false) { Routes[path] = JSON.parse(Routes[path]); }
		}catch(e){
			console.error(e);
			res.status(500).end(); return;
		}
	}

	if(Routes[path] == false) { return global.default404(req, res, "NO ROUTES JSON FILE FOR THIS DOMAIN"); }

	if(req.noQueryUrl in Routes[path]){
		const r = Routes[path][req.noQueryUrl];
		if("controller" in r) { controller_path = `${path}/${r.controller}.js`; }
		if("call" in r) { call = r.call; }
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

module.exports = {
	treatRequest,
}