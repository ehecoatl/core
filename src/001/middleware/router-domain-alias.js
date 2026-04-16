function _get_webserver_domain_regexp(host, domain){
  return host.replace(new RegExp(`\.?${domain.replace(/^https:\/\/|\/$/g,"").replace(".","\.")}(:[0-9]{1,4})?$`, "g"), "");
} 

exports = async function(req, res){
  const alias = global.router.validAlias(req._host);
  if(!alias || alias == ""){
    global.default404(req, res, "DOMAIN NOT FOUND");
    return true;
  }else{ // ALIAS OR REDIRECT DOMAIN
    req.request_raw_sub = _get_webserver_domain_regexp(req._host, alias);
    req.request_sub = req.request_raw_sub.length == 0 ? "www" : req.request_raw_sub;

    const alias_data = global.config.alias_domains[alias];
    if(req.request_sub in alias_data){
      return await global.router.redirect(req, res, alias_data[req.request_sub]);
    }else{
      global.default404(req, res, "ALIAS DOMAIN NOT FOUND");
    }
  }
  return false;
}