/*

MAIN SETUP/CONFIG SCRIPT

*/

global.JSON5 = require('json5');
const _path = require('path');
global.main_path = _path.resolve(__dirname, "../../");
global.path = {
  resolve: (p) => _path.resolve(global.main_path, p),
  extname: (f) => _path.extname(f),
  get_json: (p) => JSON5.parse( global.fs.readFileSync(p, "utf-8") ),
  get_json_async: async (p) => JSON5.parse( await global.fsp.readFile(p, "utf-8") ),
};

global.https = global.https ?? require('https');
global.fs = global.fs ?? require('fs');
global.fsp = global.fsp ?? fs.promises;
global.zlib = global.zlib ?? require('zlib');
global.crypto = global.crypto ?? require('crypto');

global.now = () => {
  return (new Date()).toLocaleString(
    global.config.datetime_lang ?? 'pt-BR',
    { timeZone: global.config.datetime_timezone ?? 'America/Sao_Paulo' }
  );
};
global.date_system = (s) => {
  return (new Date()).toLocaleDateString(
    'ja-JP', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: global.config.datetime_timezone ?? 'America/Sao_Paulo'
    }
  ).replaceAll("/",s??"-");
};
global.time_system = (s) => {
  return (new Date()).toLocaleTimeString(
    global.config.datetime_lang ?? 'pt-BR',
    { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, // Use 24-hour format
      timeZone: global.config.datetime_timezone ?? 'America/Sao_Paulo'
    }
  ).replaceAll(":",s??"-");
};
global.log = (msg) => { console.log(`[${global.now()}] `+msg); };
global.get_ip = (req) => {
  if("_client_ip" in req) return req._client_ip;
  const ip_header = global.config.services?.cdn?.client_ip_header??"";
  req._client_ip = (ip_header in req.headers) ? req.headers[ip_header] : req.connection.remoteAddress;
  return req._client_ip;
}

global._setInterval = setInterval;
global.setInterval = (callback, time, roll=false, ...args) => {
  console.log("++ INTERVAL ++")
  if(typeof callback !== "function") { throw "[global.startInterval in main.js] Invalid callback"; return; }
  if(typeof time !== "number" || time < 10) { throw "[global.startInterval in main.js] Invalid time"; return; }
  if(roll) { callback.apply(null, args); }
  return _setInterval.apply(null, [callback, time, ...args]);
};

global.loopThrough = async (elements, callback = (index,element)=>{}) => {
  for(let i=0, l=elements.length;i<l;i++){
    await callback(i, elements[i]);
  }
}

global.app = null;
global.server = {};
global.config = {};
global.running = {};

function startWebServer(port){
  if(running[port] ?? false) return;
  const ssl_options = {
      key: global.config.ssl.key.length > 0 ? global.fs.readFileSync(global.config.ssl.key, 'utf8') : null,
      cert: global.config.ssl.cert.length > 0 ? global.fs.readFileSync(global.config.ssl.cert, 'utf8') : null,
  };

  global.app = global.router.setupExpressServer(global.app, port);
  server[port] = global.https.createServer(ssl_options, global.app);
  server[port].listen(port, function(){ 
    log(`Web server started :${port}`); 
    running[port] = true;
  });
  global.cdn.checkAssetFiles();
}

/*function stopWebServer(port, callback){
  if(!running[port]??false) return;
  server[port].close(function() { 
    console.log(`Web server closed :${port}`); 
    running[port] = false;
    if(callback && typeof callback == "function") { callback(); }
  });
}*/

(async () => {
  const load_scripts = await global.path.get_json_async(`${__dirname}/loader.json`);
  for(const c in load_scripts.config){
    global.config[c] = load_scripts.config[c];
  }

  console.log("-----------");
  console.log("--LOADING--");
  console.log("-----------");
  log("");
  var error_loading = false;
  for(const s in load_scripts.scripts){
    var loaded = `[${s}] `;
    try{
      const tmp_path = load_scripts.scripts[s];
      const tmp_config_path = `${tmp_path.replace(/^\.?\/[a-zA-Z]+\//g,"/config/")}on`;
      const tmp_config = await global.path.get_json_async(`${__dirname}/${tmp_config_path}`);
      for(const i in tmp_config){
        global.config[i] = tmp_config[i];
        loaded += `${i}, `;
      }
      console.log(`LOADED CONFIG: ${loaded}`);
    }catch(e){
      error_loading = true;
      console.log(`ERRORED LOAD: ${loaded}`);
      console.log(e);
    }
  }
  
  log("");

  for(const s in load_scripts.scripts){
    var loaded = `[${s}] ${load_scripts.scripts[s]}`;
    try{
      global[s] = require(load_scripts.scripts[s]);
      console.log(`LOADED REQUIRE: ${load_scripts.scripts[s]}`);
    }catch(e){
      console.log(`ERRORED LOAD REQUIRE: ${loaded}`);
      console.log(e);
      error_loading = true;
    }
  }

  if(error_loading){ return log(`----- ERROR LOADING`); }

  console.log("-----------");
  console.log("---START---");
  console.log("-----------");
  log("");
  try{
    await global.router.loadDomains();
    startWebServer(config.webserver_port);
  }catch(e){
    log(`----- ERROR STARTING SERVER`);
    throw e;
  }
})();