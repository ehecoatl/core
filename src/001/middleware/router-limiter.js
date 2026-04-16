const rateLimit = require('express-rate-limit');
const reqQueue = require('express-queue');

global.ipcheck = global.ipcheck ?? require('ip-range-check');

global.errored_ips_file = global.path.resolve('cache/errored_ips.json');
global.errored_ips = JSON5.parse(fs.readFileSync(global.errored_ips_file, 'utf8'));

global.blocked_ips_file = global.path.resolve('cache/blocked_ips.json');
global.blocked_ips = {block:[]}; //JSON5.parse(fs.readFileSync(global.blocked_ips_file, 'utf8'));

/*(async ()=>{
  for(let i in global.errored_ips){
    const s = new Set(global.errored_ips[i]);
    if(s.size > 50 
      && global.blocked_ips.block.indexOf(i) == -1){
      global.blocked_ips.block.push(`${i}`);
    }
  }

  await global.fileWriteAsync(
    global.blocked_ips_file,
    JSON.stringify(global.blocked_ips, null, 2)
  );
  global.services.blockIPs(global.blocked_ips.block);
})();*/

const m_queue = reqQueue({ 
  activeLimit: global.config.limiter.queue_active_limit, 
  queuedLimit: global.config.limiter.queue_queued_limit,
  rejectHandler: (req, res) => { res.json({ success: false, queue: m_queue.queue.getLength() }); }
});
exports.mid_queue = m_queue;

exports.mid_ip = rateLimit({
  max: global.config.limiter.rate_ip_max,
  windowMs: global.config.limiter.rate_ip_window_ms,
  keyGenerator: (req, res) => {
    return global.get_ip(req);
  },
  message: "Too many requests from same origin, please try again later. <a href='javascript:window.location.reload(true);'>Try Again</a>.",
});

exports.mid_url = rateLimit({
  max: global.config.limiter.rate_url_max,
  windowMs: global.config.limiter.rate_url_window_ms,
  keyGenerator: (req, res) => {
    return req.url.replace(/\?.*$/, "");
  },
  message: "Too many requests to same URL, please try again later. <a href='javascript:window.location.reload(true);'>Try Again</a>.",
});

exports.checkBlock = async function check(req, res){
  const user_ip = global.get_ip(req);
  const host = req.get('host');

  if(req.url.startsWith(`${global.config.session_path}/clear_errored_ip`)){
    global.cache.setNoCache(res);
    global.errored_ips[user_ip] = [];
    await global.fileWriteAsync(
      global.errored_ips_file,
      JSON.stringify(global.errored_ips)
    );
    res.json({success: true, cleared_ip: user_ip, timestamp: global.now()});
    return true;
  }

  const is_crawler = await global.crawler.testReverseForwardDNS( user_ip );

  //CHECK GOOGLEBOTS IPS
  if( !is_crawler ) {
    //CHECK IF BLOCKED
    if(user_ip in global.errored_ips &&
    (global.errored_ips[user_ip].length > 5 ||
    global.errored_ips[user_ip].filter(x => x == req.noQueryUrl).length > 5) ){
      console.error(`XXX IP BLOCKED ${user_ip} ~~ ${req.method} ${host}${req.originalUrl}`);
      global.applogger(`${user_ip} ~~ ${req.method} ${host}${req.originalUrl}`, 'block', req);

      global.cache.setCacheForever(res);
      res.status(404).end();

      this.blockAccess(req, res);

      return true;
    }
  }else{
    //!global.ipcheck( user_ip,  global.config.crawlerbots_ips )
    log("~~ CRAWLER BOT ACCESS ~~", global.user_hostnames??"none");
  }

  //CHECK CDN IPS
  if(global.config.services.cdn.proxy == true && !global.ipcheck(
    req.connection.remoteAddress, 
    global.config.services.cdn.origin_ips
  )) { 
    log("~~ ACCESS FROM NON CDN IP ~~ BLOCKING IN LOCAL FIREWALL");
    /*global.sudo.exec(`ufw deny from ${req.connection.remoteAddress} to any port 443`,
      { name: 'MyApplicationName' },
      function(error, stdout, stderr) {
        if (error) throw error;
        console.log('* stdout: ' + stdout, '* stderr: ' + stderr);
      }
    );*/
    global.default403(req, res, "INVALID CDN IP");
    return true;
  }

  //CHECK ROUTE REGEX
  if(req.url.length > 1 && /^(\/[a-z0-9A-Z-\._]{2,10}){0,4}(\/[a-z0-9A-Z-\._]{2,50}){0,1}(\?[^\s]{0,})?$/.test(req.url) === false){
    global.default404(req, res, "INVALID REGEX URL"); 
    return true;
  }

  return false;
}

exports.blockAccess = async function block(req, res){
  const user_ip = global.get_ip(req);
  if(!(user_ip in global.errored_ips)) { global.errored_ips[user_ip] = []; }
  global.errored_ips[user_ip].push(`${req.noQueryUrl}`);
  await global.fileWriteAsync(
    global.errored_ips_file,
    JSON.stringify(global.errored_ips)
  );
  
  if(!("block" in global.blocked_ips)) { global.blocked_ips["block"] = []; }

  //ADD TO BLOCK LIST
  if(global.errored_ips[user_ip].length > 20 
    && global.blocked_ips.block.indexOf(user_ip) == -1){
    global.blocked_ips.block.push(`${user_ip}`);
    await global.fileWriteAsync(
      global.blocked_ips_file,
      JSON.stringify(global.blocked_ips, null, 2)
    );
    global.services.blockIPs(global.blocked_ips.block);
  }

}