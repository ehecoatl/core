/*

STATIC APP SCRIPT

*/

const WOLIMP_WEBSERVER_VERSION = "001";

const _path = require('path');
global.main_path = __dirname;
global.path = {
  resolve: (p) => _path.resolve(global.main_path, p),
  extname: (f) => _path.extname(f)
};

global.safe_cookie_config = { secure: true, httpOnly: true, sameSite: 'strict', maxAge: 60 * 60 * 1000, path: "/run" };

global.dnsPromises = require('dns').promises;
global.ipcheck = require('ip-range-check');
global.fs = require('fs');
global.zlib = require('zlib');
global.https = require('https');
global.crypto = require('crypto');
global.dt = require('date-and-time');
global.importFresh = require('import-fresh');
global.format = dt.format;
global.fsp = fs.promises;
global.config = 
//global.config = JSON.parse(fs.readFileSync(global.path.resolve(`./src/_webserver/${WOLIMP_WEBSERVER_VERSION}/config/_config_server.json`), 'utf8'));
global.get_route = (label) => config.route[label]??config.route.default;
global.log = (msg) => {
  console.log(`[${new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}] `+msg);
}

var main = require(`./src/_webserver/${WOLIMP_WEBSERVER_VERSION}/main.js`);

global.replaceK2V = function(string, source_obj, key_mask = null, replace_mask = null) {
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
}

global.fileExistsAsync = async (filePath) => {
  try {
    await global.fsp.access(filePath);
    return true; // File exists
  } catch (error) {
    if (error.code === 'ENOENT') { return false; } // File does not exist 
    throw error;
  }
}

global.fileStatAsync = async (filePath) => {
  try {
    return await global.fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') { console.error(error); } // File does not exist 
    return false;
  }
}

global.fileReadAsync = async (filePath, encoding="utf8", display=true) => {
  try {
    return await global.fsp.readFile(filePath, encoding);
  } catch (error) {
    if (error.code === 'ENOENT' && display) { console.error(error); } // File does not exist 
    return false;
  }
}
global.fileWriteAsync = async (filePath, data, encoding="utf8") => {
  try {
    await global.fsp.writeFile(filePath, data, 'utf8');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') { console.error(error); } // File does not exist 
    return false;
  }
}
global.fileAppendLineAsync = async (filePath, line, encoding="utf8") => {
  try {
    // Append the line followed by a newline character
    await global.fsp.appendFile(filePath, line, 'utf8');
    return true;
  } catch (err) {
    console.error('Error appending to file:', err);
    return false;
  }
}
global.getJsonFromUrl = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return [];
    }
    return (await response.json());
  } catch (error) {
    console.error("Error fetching or parsing JSON:", error);
    return [];
  }
}

global.testReverseForwardDNS = async (ip, suffixes = ['.yandex.ru', '.yandex.com', '.yandex.net']) => {
    try {
        global.user_hostnames = await dnsPromises.reverse(ip);
        console.log(`Hostnames for ${ip}:`, global.user_hostnames);
        for(const h of global.user_hostnames) {
          for(const s of suffixes){ 
            if(h.endsWith(s)) {
              const result = await dnsPromises.resolve(h);
              console.log(`IP Address: ${result}`);
              if( result.indexOf(ip) > -1){
                return true;
              }
            }
          }
        }
        return false;
    } catch (err) {
        //console.error(`Reverse DNS lookup failed for ${ip}:`, err);
        return false;
    }
}

global.cloudflareCheckAssetFiles();

global.errored_ips_file = global.path.resolve('./cache/errored_ips.json');
global.errored_ips = JSON.parse(fs.readFileSync(global.errored_ips_file, 'utf8'));
global.crawlerbots_ips = [];
global.crawlerbots_hostnames = [
  '.yandex.ru', '.yandex.com', '.yandex.net',
  '.duckduckgo.com',
  '.googlebot.com', '.google.com', '.gae.googleusercontent.com',
  '.applebot.apple.com',
  '.baidu.com', '.baidu.jp',
  '.ahrefs.com', '.ahrefs.net',
  '.search.msn.com',
];

async function updateCrawlerBotIps(){
  const bots_json = [
    "https://developers.google.com/search/apis/ipranges/googlebot.json",
    "https://www.gstatic.com/ipranges/goog.json",
    "https://search.developer.apple.com/applebot.json",
    "https://www.bing.com/toolbox/bingbot.json",
    "https://duckduckgo.com/duckduckbot.json",
    "https://api.ahrefs.com/v3/public/crawler-ip-ranges"
  ];
  for(const b in bots_json){
    try{
      const data = await global.getJsonFromUrl(b);
      if("prefixes" in data){
        for(const i of data.prefixes){ 
          global.crawlerbots_ips.push( i.ipv6Prefix ?? i.ipv4Prefix ); 
        }
      }
    }catch(e){
      console.error(e);
    }
  }

  log("CRAWLER BOTS IPS - updated");
}

//updateCrawlerBotIps();

log("---------");
log("---------");
log("---------");

main.startWebServer(config.webserver_port);

setInterval(async ()=>{
  try{
    await global.fsp.truncate("/root/.pm2/logs/-html-out.log");
    await global.fsp.truncate("/root/.pm2/logs/-html-out.log");
    await global.fsp.truncate("/root/.pm2/pm2.log");
    //await updateCrawlerBotIps();
  }catch(e){
    console.error(e);
  }
}, 2*60*1000); //2 minutes