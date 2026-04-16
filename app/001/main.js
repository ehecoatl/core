/*

MAIN SETUP/CONFIG SCRIPT

*/

global.https = global.https ?? require('https');
global.fs = global.fs ?? require('fs');
global.fsp = global.fsp ?? fs.promises;

global.app = null;
global.server = {};
global.config = {};
global.running = {};

//global.console.log = (...args) => true;

global.JSON5 = global.JSON5??require('json5');
const _path = require('path');
global.path = {
  resolve: (p) => _path.resolve(global.main_path, p),
  extname: (f) => _path.extname(f),
  get_json: (p) => JSON5.parse( global.fs.readFileSync(p, "utf-8") ),
  get_json_async: async (p) => JSON5.parse( await global.fsp.readFile(p, "utf-8") )
};
global.main_path = _path.resolve(__dirname, "../../");
global.console.log_title = (t) => console.log("\x1b[1m\x1b[32m"+t+"\x1b[0m");

(async () => {
  const load_scripts = await global.path.get_json_async(`${__dirname}/loader.json`);
  for(const c in load_scripts.config){
    global.config[c] = load_scripts.config[c];
  }

  console.log_title("-----------");
  console.log_title("--LOADING--");
  console.log_title("-----------");
  console.log("");
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
  
  console.log("");

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

  if(error_loading){ return global.log(`----- ERROR LOADING`); }

  console.log_title("-----------");
  console.log_title("---START---");
  console.log_title("-----------");
  global.log("");
  try{
    await global.router.loadDomains();
    startWebServer(config.webserver_port);
  }catch(e){
    global.log(`----- ERROR STARTING SERVER`);
    throw e;
  }
})();

function startWebServer(port){
  if(running[port] ?? false) return;
  const ssl_options = {
      key: global.config.ssl.key.length > 0 ? global.fs.readFileSync(global.config.ssl.key, 'utf8') : null,
      cert: global.config.ssl.cert.length > 0 ? global.fs.readFileSync(global.config.ssl.cert, 'utf8') : null,
  };

  global.app = global.router.setupExpressServer(global.app, port);
  server[port] = global.https.createServer(ssl_options, global.app);
  server[port].listen(port, function(){ 
    global.log(`Web server started :${port}`); 
    running[port] = true;
  });
}