global.genuuid = global.genuuid??require('uuid').v4;

const compression = require('compression');

exports.builder = require("./responser-builder.js");
exports.Replacer = require("./responser-replacer.js").Replacer;

exports.mid_compress = compression({ 
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {return false;}
    return compression.filter(req, res)
  } 
});

/*global.replaceK2V = function(string, source_obj, key_mask = null, replace_mask = null) {
  if(!source_obj || typeof source_obj !== "object" || key_mask == "" || replace_mask == "") return string;

  const values = {}
  const replacer = (!replace_mask || typeof replace_mask !== "string") ?
    (...args) => values[args[0]] : 
    (...args) => replace_mask.replace("?",values[args[0]]);
  const escaper = (s) => s.replace(/[.*+?^${}()[\]\\]/g, '\\$&'); // | missing

  const regex_keys = [];
  for(const k in source_obj){
    if(typeof k !== "string" || k.length == 0) continue;
    const key = (!key_mask || typeof key_mask !== "string") ? k : key_mask.replace("?",k);
    values[key] = source_obj[k];
    regex_keys.push(key);
  }
  return regex_keys.length == 0 ? string : string.replace(
    new RegExp(`(${escaper(regex_keys.join("|"))})`, "g"), 
    replacer
  );
}*/

global.validMethod = (method, req, res) => {
	const m = req.method == method;
	if(!m) { res.status(405).end(); }
	return m;
}

exports.checkLastMod = async (req, res, etag_check_files = []) => {
  if(global.config.debug_no_cache === true) return;

  const ifms = req.headers["if-modified-since"] ?? null;
  //global.log(`Access to ${req.url} - If modified since ${ifms??'-'}`);

  var latest = new Date(ifms ?? "1990-01-01 00:00:00");
  for(let f of etag_check_files){
    // let exists = await global.fileExistsAsync(f);
    // if(!exists) { res.status(404).end();return true; } //Doesn't exist

    let stat = await global.fileStatAsync(f);
    if(!stat || stat.isDirectory()) { log(f); global.default404(req, res, "FILE NOT FOUND WHEN CHECKING FOR CACHE"); return true; } //Accessing directory

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