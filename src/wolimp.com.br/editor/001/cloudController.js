const label = "DOCS";
const library = [];

async function uuid(req, res) {
	if(!global.validMethod("GET", req, res) ||
		await global.checkLastMod(req, res, [`${__dirname}/uuid`])) { return; }

	const fileContent = await global.cacheUUID(__dirname);

	global.setCache(res, 30, 31536000);
	res.setHeader("Content-Type", "application/json");
	res.send(fileContent);
}

async function models(req, res) {
	if(!global.validMethod("GET", req, res)) { return; }

	library.length = 0; //CLEAR
	const models_folder = "/var/html/wolimp_models";
	const entries = await global.fsp.readdir(models_folder, { withFileTypes: true });
	for(const entry of entries){
		if(!entry.isFile()) { //SUBDOMAINS IN FOLDERS
			library.push(entry.name);
		}
	}

	const library = {
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

	global.setCache(res, 30, 31536000);
	res.json(library);
}

var base_controller;
function setBase(_base_controller){
	base_controller = _base_controller;
}

module.exports = {
	setBase,
	uuid,
	models
}