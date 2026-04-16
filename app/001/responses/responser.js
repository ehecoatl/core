exports.builder = require("./responser-builder.js");
exports.Replacer = require("./responser-replacer.js").Replacer;

global.validMethod = (method, req, res) => {
  if(req.method == "OPTIONS"){
    res.setHeader('Access-Control-Allow-Methods', method);
    //res.setHeader('Access-Control-Allow-Origin', 'http://your-allowed-origin.com');
    //res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    res.status(204).end();
    return false;
  }
	const m = req.method == method;
	if(!m) { res.status(405).end(); }
	return m;
}

exports.checkLastMod = async (req, res, etag_check_files = []) => {
  if(global.config.debug_no_cache === true) return false;

  const ifms = req.headers["if-modified-since"] ?? null;

  var latest = new Date(ifms ?? "1990-01-01 00:00:00");
  for(let f of etag_check_files){

    let stat = await global.fileStatAsync(f);
    if(!stat || stat.isDirectory()) { 
      log(`FILE NOT FOUND WHEN CHECKING FOR CACHE: ${f}`);
      continue;
    } //Accessing directory

    try{
      let d = stat.mtime;
      if(d.getTime() > latest.getTime()) latest = d;
    }catch(e){
      global.default404(req, res, "INVALID FILE TIME");
      return true;
    }
  }
  latest.setMilliseconds(0);

  req.lastModified = latest.toUTCString();
  res.setHeader('Last-Modified', req.lastModified);

  if (ifms && new Date(ifms).getTime() >= latest.getTime()) {
    res.status(304).end();
    if(global.config.log_cache) { global.log(`> Not Modified 304 -> ${req.originalUrl}`); }
    return true;
  }
  
  if(global.config.log_cache) { global.log(`-> Serve Data -> ${req.originalUrl}`); }

  return false;
}