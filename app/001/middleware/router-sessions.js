global.genuuid = global.genuuid??require('uuid').v4;

const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cookieParser = require('cookie-parser');  
const safe_cookie_config = { secure: true, httpOnly: true, sameSite: 'strict', maxAge: global.config.sessions.max_age, path: global.config.sessions.cookie_path };
const m_session = {};

/* TODO: Session cookie settings per domain, and default config */

//GENERATE NEW TOKEN
module.exports.generateCSRF = function (req, res) {
  const token_id = global.config.sessions.csrf_token_id;
  req.session[token_id] = global.genuuid();
  req.session[`${token_id}_time`] = Date.now();
  res.cookie(encodeURIComponent(token_id), req.session[token_id], global.safe_cookie_config);
}

exports.mid_get_session = async function (req, res, next) {
  const host = req.get('host');
  if(host in m_session) { return m_session[host](req, res, next); }

  const session_folder = `${req.dom_path}/${global.config.sessions.folder}`;

  try{ await global.fs.promises.chmod(session_folder, 0o777); }
  catch(e){ throw e; }

  m_session[host] = session({ 
      name:global.config.sessions.cookie_name,
      genid: (req) => { global.log("# NEW SESSION AT "+host); return `${req.request_sub}.${global.genuuid()}`; }, // use UUIDs for session IDs
      secret: global.config.sessions.secret,
      store: new FileStore({ 
        path: `${session_folder}`,
        fileExtension: `.json`
      }),
      proxy: true,
      resave: false,
      saveUninitialized: true,
      maxAge: global.config.sessions.max_age,
      cookie: safe_cookie_config
  });
  return m_session[host](req, res, next);
}

//CHECK FOR VALID TOKEN IN CURRENT REQUEST
module.exports.checkCSRF = function (req, res, next) {
  const token_id = global.config.sessions.csrf_token_id;
  const max_age = global.config.sessions.csrf_max_age;

  if(!(token_id in req.session) ||
      req.session[token_id] != req.cookies[encodeURIComponent(token_id)]){
    global.default403(req, res, "INVALID CSRF TOKEN SENT IN COOKIE"); 
    return next(false);
  }
  
  //ALLOW ACTION, BUT GENERATES ANOTHER CSRF FOR NEXT CALLS
  this.generateCSRF(req, res);

  //Check for timout  
  if(Date.now() - req.session[`${token_id}_time`] > max_age){
    global.default403(req, res, "CSRF TOKEN TIMEOUT"); 
    return next(false);
  }

  next();
}

module.exports.builder = function (req, res, next){
  req.csfrCheck = (req.method != "GET");

  //PREVENT POST PUT PATCH DELETE FROM CSRF
  if(req.csfrCheck){
    const s = req.headers["sec-fetch-site"];
    if(s !== "same-origin" || s !== "same-site"){
      global.default403(req, res, "NOT SAME ORIGIN/SITE"); 
      return next(false);
    }else if(!(global.config.sessions.csrf_token_id in req.headers) || !("content-type" in req.headers) ||
      req.headers["content-type"] != "application/json"){
      global.default403(req, res, "INVALID RUN* REQUEST HEADERS"); 
      return next(false);
    }
  }

  this.mid_get_session(req, res, ()=>{
    cookieParser()(req, res, ()=>{
      if(req.csfrCheck) { this.checkCSRF(req, res, next); }
      else { next(); }
    });
  });
}