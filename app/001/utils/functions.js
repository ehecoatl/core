global.cache_path_resolve = (p) => global.path.resolve(`_cache/${p}`);

global.get_ip = (req) => {
  if("_client_ip" in req) return req._client_ip;
  const ip_header = global.config.services?.cdn?.client_ip_header??"";
  req._client_ip = (ip_header in req.headers) ? req.headers[ip_header] : req.connection.remoteAddress;
  return req._client_ip;
}

global.concatArray = (strings, join=",") => {
  let result = '';
  for (let i=0, l=strings.length; i<l ; i++) { result += (i===0?"":join) + strings[i]; }
  return result.replace(join,"");
}

global._setInterval = setInterval;
global.setInterval = (callback, time, roll=false, ...args) => {
  //console.log("++ INTERVAL ++")
  if(typeof callback !== "function") { throw "[global.startInterval in main.js] Invalid callback"; return; }
  if(typeof time !== "number" || time < 10) { throw "[global.startInterval in main.js] Invalid time"; return; }
  if(roll) { callback.apply(null, args); }
  return _setInterval.apply(null, [callback, time, ...args]);
};

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