global.genuuid = global.genuuid??require('uuid').v4;

const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cookieParser = require('cookie-parser');  
const safe_cookie_config = { secure: true, httpOnly: true, sameSite: 'strict', maxAge: global.config.sessions.max_age, path: global.config.sessions.cookie_path };
const m_session = {};

/* TODO: Session cookie settings per domain, and default config */

exports.setup = function (app){
  app.get(`${global.config.session_path}/user_data`, async (req, res, next) =>{
      global.cache.setCache(res, 10);
      if(!req.session) { return res.status(400).end(); }
      const user_data = 'user_data' in req.session ? req.session['user_data'] : null;
      this.generateCSRF(req, res);
      res.json({ success: true, data: user_data });
  });
}

exports.mid_session = async (req, res, next) => {
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
  if(req.session[token_id] != req.cookies[encodeURIComponent(token_id)]){
    return global.default403(req, res, "INVALID CSRF TOKEN SENT IN COOKIE"); 
  }
  //ALLOW ACTION, BUT GENERATES ANOTHER CSRF FOR NEXT CALLS
  this.generateCSRF(req, res);
  next();
}

//GENERATE NEW TOKEN
module.exports.generateCSRF = function (req, res) {
  const token_id = global.config.sessions.csrf_token_id;
  req.session[token_id] = global.genuuid();
  res.cookie(encodeURIComponent(token_id), req.session[token_id], global.safe_cookie_config);
}

module.exports.mid_csrf = async (req, res, next) =>{
  req.cloudActionRequest = req.url.indexOf(`${global.config.session_path}/`) === 0;
  req.sessionCloud = req.cloudActionRequest && !req.noQueryUrl.startsWith(`${global.config.session_path}/uuid`);
  req.csfrCheck = req.method == "POST";

  //PREVENT POST PUT PATCH DELETE FROM CSRF
  if(req.csfrCheck){
    const s = req.headers["sec-fetch-site"];
    if(s !== "same-origin" || s !== "same-site"){
      return global.default403(req, res, "NOT SAME ORIGIN/SITE"); 
    }else if(!req.cloudActionRequest || !(global.config.sessions.csrf_token_id in req.headers) || !("content-type" in req.headers) ||
      req.headers["content-type"] != "application/json"){
      return global.default403(req, res, "INVALID RUN* REQUEST"); 
    }
  }

  if(req.sessionCloud){
    return global.sessions.mid_session(req, res, ()=>{
      return cookieParser()(req, res, ()=>{
        if(req.csfrCheck) { this.checkCSRF(req, res, next); }
        else { next(); }
      });
    });
  }
  
  next();
}