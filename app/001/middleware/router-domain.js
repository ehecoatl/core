function _get_webserver_domain_regexp(host, domain){
  return host.replace(new RegExp(`\.?${domain.replace(/^https:\/\/|\/$/g,"").replace(".","\.")}(:[0-9]{1,4})?$`, "g"), "");
} 

function _get_generic_webserver_subdomain_regexp(host){
  return host.replace(/^https:\/\/([^\.]*)\.(.*)/g, "$1");
}

const route_config = {};

const router_domain_alias = require("./router-domain-alias.js");

async function mid_domain(req, res) {
    req._host = req.get('host');
    res._host = req._host;
    res.noQueryUrl = req.noQueryUrl;

    //DOMAIN
    req.request_domain = global.router.validDomain(req._host);
    if(!req.request_domain || req.request_domain == "") {
      if(router_domain_alias(req, res)) return true;
      req.request_domain = global.router.validDomain(req._host);
      req.request_raw_sub = _get_webserver_domain_regexp(req._host, req.request_domain);
    }else{ //SUBDOMAIN
      req.request_raw_sub = _get_webserver_domain_regexp(req._host, req.request_domain);
    }

    req.request_sub = (typeof req.request_raw_sub == undefined) || req.request_raw_sub.length == 0 ? "www" : req.request_raw_sub;
    const subdomain_version = req.request_sub.match(/(?<sub>\w+)-v-(?<version>\w+)/);
    if(subdomain_version) { req.request_sub = subdomain_version.groups.sub; }

    //REDIRECT IF EPANEL
    if(req.request_sub === global.config.epanel_subdomain && global.config.epanel_enabled){
      req.dom_path = `${global.config.epanel_folder}`;
      req.root_path = `${global.config.epanel_folder}`;
    }else{
      req.dom_path = `${global.config.web_folder}/${req.request_domain}`;
      req.root_path = `${global.config.web_folder}/${req.request_domain}/${req.request_sub}`;
    }

    //VERSION ROUTE
    if(subdomain_version) { 
      req.version = subdomain_version.groups.version;
    } else {
      req.version = global.router.get_route_version(req.root_path);
    }
    req.root_path += `/${req.version}`;
    
    //DOES DOMAIN NEEDS DIF PORT?
    const domainPort = req.request_domain.split(':');
    if(domainPort.length > 1) { 
      const reqPort = req._host.split(':');
      if(reqPort.length == 2 || reqPort[1] != domainPort[1]) {
        global.cache.setCacheForever(res);
        res.redirect(301, `https://${req._host}:${domainPort[1]}${req.url}`);
        return true;
      }
    }

    try{
      //COUNTRY & LANGUAGE
      const country_header = global.config.services?.cdn?.client_country_header??"";
      const country = (country_header in req.headers) ? req.headers[country_header] : "XX";
      if(!(req._host in route_config)){
        route_config[req._host] = await global.path.get_json_async(`${req.root_path}/_config.json`);
      }
      req.lang = route_config[req._host].lang_country[country] ?? route_config[req._host].lang_default;
    }catch(e){
      req.lang = global.config.lang_default;
    }

    //CORS FOR ORIGIN != HOST
    const origin = req.get('origin');
    if(origin && global.router.validDomain(origin)) { 
      res.setHeader('Access-Control-Allow-Origin', origin); 
    }

    return false;
}

module.exports = mid_domain;