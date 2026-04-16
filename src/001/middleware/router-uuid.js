async function router_uuid(req, res, path){
	if(req.url.startsWith(`${global.config.session_path}/uuid`)) {
      if(global.validMethod("GET", req, res) && 
        !(await global.responser.checkLastMod(req, res, [`${path}/uuid`]))){
          const fileContent = await global.router.cacheUUID(`${path}`);
          global.cache.setCache(res, 30, 31536000);
          res.setHeader("Content-Type", "application/json");
          res.send(fileContent);
      }
      return true;
    }
    return false;
}

module.exports = router_uuid;