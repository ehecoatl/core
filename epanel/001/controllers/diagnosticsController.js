const label = "DIAGNOSTICS";

var base_controller;
module.exports.setBase = function (_base_controller){
	base_controller = _base_controller;
}

module.exports.uuid = async function (req, res){
  if(!global.validMethod("GET", req, res) ||
    await global.responser.checkLastMod(req, res, [`${req.root_path}/uuid`])) return;

  const fileContent = await global.router.cacheUUID(`${req.root_path}`);
  global.cache.setCache(res, 30, 31536000);
  res.setHeader("Content-Type", "application/json");
  res.send(fileContent);
}

module.exports.user_data = async function (req, res){
	if(!global.validMethod("GET", req, res)) return;
	
	global.cache.setCache(res, 10);
	if(!req.session) { return res.status(400).end(); }
	const user_data = 'user_data' in req.session ? req.session['user_data'] : null;
	global.router.sessions.generateCSRF(req, res);
	res.json({ success: true, data: user_data });
}

const library = [];
module.exports.models = async function (req, res) {
	if(!global.validMethod("GET", req, res)) { return; }

	library.length = 0; //CLEAR
	const models_folder = "/var/webserver/source";
	const entries = await global.fsp.readdir(models_folder, { withFileTypes: true });
	for(const entry of entries){
		if(!entry.isFile()) { //SUBDOMAINS IN FOLDERS
			library.push(entry.name);
		}
	}

	const l = {
		data: [
			{ data1: 1 },
			{ data2: 2 }
		],
		total_items: 120,
		total_pages: 10,
		page_size: 12,
		page: 0,
		last_update: ""
	};

	global.cache.setCache(res, 30, 31536000);
	res.json(l);
}