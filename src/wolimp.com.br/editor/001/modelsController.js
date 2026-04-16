const label = "DOCS";

async function index(req, res) {
	if(!global.validMethod("GET", req, res)) return;

	const models_folder = "/var/html/wolimp_models";
	const model_name = req.routeCall[2];
	
	const call = [...req.routeCall]; call.splice(0,3);
	const asset_path = (call.length > 0) ? call.join("/") : null;

	if(asset_path && asset_path.length > 0){
		return await global.serveAsset(req, res, `${models_folder}/${model_name}`, asset_path);
	}
	
	return global.default404(req, res, "CALL "+call+" or INDEX DOESNT EXIST");
}

var base_controller;
function setBase(_base_controller){
	base_controller = _base_controller;
}

module.exports = {
	setBase,
	index
}