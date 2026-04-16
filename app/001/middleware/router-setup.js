const express = require('express');

module.exports = function (app, port){
  if(app != null) return;

  app = express();
  app.set('trust proxy', global.config.trust_proxy?1:0);

  if(global.config.limiter.rate_ip_enabled)
    app.use(global.limiter.mid_ip); // Limit per access IP
  
  if(global.config.limiter.rate_url_enabled)
    app.use(global.limiter.mid_url); // Limit per URL
  
  if(global.config.limiter.queue_enabled)
    app.use(global.limiter.mid_queue); // Hold requests in Queue
  
  app.use(global.limiter.mid_compress);

  app.use(global.router.mid_router);

  app.all('/*', async (req, res, next) => {
    req.routeCall = req.noQueryUrl.split("/");
    await global.router.treatRequest(
      req.routeCall.length <= 1 || req.routeCall[1].length == 0 ? "index" : req.routeCall[1], 
      req.routeCall.length <= 2 ? "" : req.routeCall[2], 
      req, res
    );
  });

  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).end(); //.send({ error: err.message });
  });

  return app;
}