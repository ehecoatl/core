/*

MAIN SETUP/CONFIG SCRIPT

*/

global.load_scripts = JSON.parse(global.fs.readFileSync(`${__dirname}/loader.json`,"utf-8"));

for(const s in load_scripts){
  global[s] = require(load_scripts[s]);
  var tmp_config = JSON.parse(global.fs.readFileSync(`${__dirname}/${load_scripts[s].replace("./js/","/config/")}on`,"utf-8"))
  for(const i in tmp_config){
    global.config[i] = tmp_config[i];
  }
}
delete global.load_scripts;

var app = null, server = {}, running = false;

const sudo = require('sudo-prompt');
const { v4: genuuid } = require('uuid');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const reqQueue = require('express-queue');

const session = require('express-session');
const FileStore = require('session-file-store')(session);

const url_origins = config.domains;

function _get_webserver_domain_regexp(host, domain){
  return host.replace(new RegExp(`\.?${domain.replace(/^https:\/\/|\/$/g,"").replace(".","\.")}(:[0-9]{1,4})?$`, "g"), "");
} 

function _get_generic_webserver_subdomain_regexp(host){
  return host.replace(/^https:\/\/([^\.]*)\.(.*)/g, "$1");
}

const m_queue = reqQueue({ 
  activeLimit: 5, 
  queuedLimit: 100,
  rejectHandler: (req, res) => { res.json({ success: false, queue: m_queue.queue.getLength() }); }
});

const m_limiter = rateLimit({
  max: 100,
  windowMs: 1000*10, // 10s
  keyGenerator: (req, res) => {
    return global.config.cloudflare == true ? req.headers['cf-connecting-ip'] : req.connection.remoteAddress;
  },
  message: "Too many requests from same origin, please try again later. <a href='javascript:window.location.reload(true);'>Try Again</a>.",
});

const m_limiter_url = rateLimit({
  max: 1200,
  windowMs: 1000*60, // 60s
  keyGenerator: (req, res) => {
    return req.url.replace(/\?.*$/, "");
  },
  message: "Too many requests to same URL, please try again later. <a href='javascript:window.location.reload(true);'>Try Again</a>.",
});

const m_compress = compression({ 
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {return false;}
    return compression.filter(req, res)
  } 
});

const m_session = {};

function getSessionMiddleware(req, res, next) {
  const host = req.get('host');
  if(host in m_session) { return m_session[host](req, res, next); }

  m_session[host] = session({ 
      name:'WolimpSession',
      genid: (req) => { global.log("# NEW SESSION AT "+host); return `${genuuid()}`; }, // use UUIDs for session IDs
      secret: 'Axis_Secret_456987123',
      store: new FileStore({ path: global.path.resolve("./sessions"), fileExtension: `.${host.replace(/\./g,"-")}.json` }),
      proxy: true,
      resave: false,
      saveUninitialized: true,
      maxAge: 60 * 60 * 1000,
      cookie: global.safe_cookie_config
  });
  return m_session[host](req, res, next);
}

function _setup(){
  if(app != null) return;

  app = express();
  app.set('trust proxy', 1);

  app.use(m_limiter);
  app.use(m_limiter_url);
  app.use(m_queue);
  app.use(async (req, res, next) =>{
    const host = req.get('host');
    log(`~~ ${req.method} ${host}${req.originalUrl}`);
    global.applogger(`${req.method} ${host}${req.originalUrl}`, 'access');
    
    req.noQueryUrl = req.url.replace(/\?.*$/, "");

    const user_ip = global.config.cloudflare == true ? req.headers['cf-connecting-ip'] : req.connection.remoteAddress;

    if(req.url.startsWith("/cloud/clear_errored_ip")){
      global.errored_ips[user_ip] = [];
      global.setNoCache(res);
      res.json({success: true, cleared_ip: user_ip});
      return;
    }

    const is_crawler = await global.testReverseForwardDNS( user_ip, global.crawlerbots_hostnames );

    //CHECK GOOGLEBOTS IPS
    if( !is_crawler ) {
      //CHECK IF BLOCKED
      if( /^\/wp|^\/\/|\.php$|\.env$/.test(req.noQueryUrl) || 
        ( 
          user_ip in global.errored_ips &&
          (global.errored_ips[user_ip].length > 5 ||
          global.errored_ips[user_ip].indexOf(`${req.noQueryUrl}`) > -1)
        ) 
      ){
          console.error(`XXX IP BLOCKED ${user_ip} ~~ ${req.method} ${host}${req.originalUrl}`);
          global.applogger(`${user_ip} ~~ ${req.method} ${host}${req.originalUrl}`, 'block');

          global.setCacheForever(res);
          res.status(404).end();

          global.errored_ips[user_ip] = global.errored_ips[user_ip] ?? [];
          global.errored_ips[user_ip].push(`${req.noQueryUrl}`);
          await global.fileWriteAsync(
            global.errored_ips_file,
            JSON.stringify(global.errored_ips)
          );
          return;
      }
    }else{
      //!global.ipcheck( user_ip,  global.config.crawlerbots_ips )
      log("~~ CRAWLER BOT ACCESS ~~", global.user_hostnames??"none");
    }

    req.cloudActionRequest = req.url.indexOf("/cloud/") === 0;
    req.sessionCloud = req.cloudActionRequest && !req.noQueryUrl.startsWith("/cloud/uuid");
    req.csfrCheck = req.method == "POST";

    //PREVENT POST PUT PATCH DELETE FROM CSRF
    if(req.csfrCheck){
      const s = req.headers["sec-fetch-site"];
      if(s !== "same-origin" || s !== "same-site"){
        return global.default403(req, res, "NOT SAME ORIGIN/SITE"); 
      }else if(!req.cloudActionRequest || !("axis-csrf-token" in req.headers) || !("content-type" in req.headers) ||
        req.headers["content-type"] != "application/json"){
        return global.default403(req, res, "INVALID RUN* REQUEST"); 
      }
    }

    //CHECK CLOUDFLARE IPS
    if(global.config.cloudflare == true && !global.ipcheck(
      req.connection.remoteAddress, 
      global.config.cloudflare_ips
    )) { 
      sudo.exec(`ufw deny from ${req.connection.remoteAddress} to any port 443`, {},
      function(error, stdout, stderr) {
        if (error) throw error;
        console.log('* stdout: ' + stdout, '* stderr: ' + stderr);
      });
      return global.default403(req, res, "INVALID CLOUDFLARE IP");
  }

    //CHECK ROUTE REGEX
    if(req.url.length > 1 && /^(\/[a-z0-9A-Z-\._]{2,10}){0,4}(\/[a-z0-9A-Z-\._]{2,50}){0,1}(\?[^\s]{0,})?$/.test(req.url) === false){
      return global.default404(req, res, "INVALID REGEX URL"); 
    }

    //DOMAIN
    req.request_domain = url_origins.find((u) => host.includes(u.replace(/:[0-9]+/g,'')));
    if(!req.request_domain || req.request_domain == "") { 
      if(global.config.wildcard_first_domain) { 
        req.request_domain = url_origins[0];
        //SUBDOMAIN FOR CUSTOMIZED DOMAINS
        req.request_raw_sub = _get_generic_webserver_subdomain_regexp(host);
      } else { 
        return global.default404(req, res, "DOMAIN NOT FOUND, WILDCARD NOT AVAILABLE");
      }
    }else{
      //SUBDOMAIN
      req.request_raw_sub = _get_webserver_domain_regexp(host, req.request_domain);
      //if(req.request_sub.includes(".")) { return global.default404(req, res, "INVALID SUBDOMAIN"); }
    }
    req.request_sub = req.request_raw_sub.length == 0 ? "www" : req.request_raw_sub;
    req.version = global.get_route(`${req.request_sub}.${req.request_domain}`);

    req.root_path = `./src/${req.request_domain}/${req.request_sub}/${req.version}`;

    next();
  });

  app.use(m_compress);
  //ASSET MAIN ROUTES
  app.get('/assets/*|/favicon.ico|/robots.txt|/sitemap.xml', global.genServeFile);
  //404 ROUTE
  app.get('/404.htm|/*.404.htm',  async (req, res, next) => {
    global.setCacheForever(res);
    return res.status(404).send();
  });

  app.use(async (req, res, next) => {
    const host = req.get('host');
    
    //DOES DOMAIN NEEDS DIF PORT?
    const domainPort = req.request_domain.split(':');
    if(domainPort.length > 1) { 
      const reqPort = host.split(':');
      if(reqPort.length == 2 || reqPort[1] != domainPort[1]) {
        global.setCacheForever(res);
        res.redirect(301, `https://${host}:${domainPort[1]}${req.url}`);
        return;
      }
    }

    //COUNTRY & LANGUAGE
    const country = global.config.cloudflare == true ? req.headers['cf-ipcountry'] : "XX";
    req.lang = global.config.lang_country[country] ?? global.config.lang_default;

    //CORS FOR ORIGIN != HOST
    const origin = req.get('origin');
    if(origin && url_origins.find((u)=> origin.includes(u.replace(/:[0-9]+/g,'')))) { 
      res.setHeader('Access-Control-Allow-Origin', origin); 
    }

    next();
  });
  
  app.get('/', async (req, res, next) => {
    if(!url_origins.find((u) => req.get('host').includes(u))){
      global.default404(req, res, "DOMAIN NOT FOUND FOR ROOT ACCESS");
    }else{
      global.setCache(res, 3600);
      res.redirect(301, `https://${req.get('host')}/${req.lang}.index.htm`);
    }
  });
  app.get('*.*.htm|/*.manifest.json|/*.service-worker.js', global.genServeLocaleFile); // Translated LANG access

  app.use(function(req, res, next) { 
    if(req.sessionCloud){
      return getSessionMiddleware(req, res, ()=>{
        return cookieParser()(req, res, ()=>{
          if(req.csfrCheck) { global.checkCSRF(req, res, next); }
          else { next(); }
        });
      });
    } next();
  });
  
  app.get('/cloud/user_data', async (req, res, next) =>{
      global.setCache(res, 10);
      if(!req.session) { return res.status(400).end(); }
      const user_data = 'user_data' in req.session ? req.session['user_data'] : null;
      global.generateCSRF(req, res);
      res.json({ success: true, data: user_data });
  });
  app.use(express.json());
  app.all('/*', async (req, res, next) => {
    req.routeCall = req.noQueryUrl.split("/");
    await global.router.treatRequest(
      req.routeCall[1].length == 0 ? "index" : req.routeCall[1], 
      req.routeCall[2] ?? "", 
      req, res
    );
  });

  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).end(); //.send({ error: err.message });
  })
}

function startWebServer(port){
  if(running) return;
  
  _setup();

  const ssl_options = {
      key: config.ssl.key.length>0 ? fs.readFileSync(config.ssl.key, 'utf8'):null,
      cert: config.ssl.cert.length>0 ? fs.readFileSync(config.ssl.cert, 'utf8'):null,
  };
  server[port] = https.createServer(ssl_options, app);

  server[port].listen(port, function(){ 
    log(`Web server started :${port}`); 
    running = true;
  });
}

function stopWebServer(port, callback){
  if(!running) return;
  
  server[port].close(function() { 
    console.log(`Web server closed :${port}`); 
    running = false;
    if(callback && typeof callback == "function") { callback(); }
  });
}

module.exports = {
  startWebServer,
  stopWebServer,
};