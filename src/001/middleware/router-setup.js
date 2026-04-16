const express = require('express');

function setupExpressServer(app, port){
  if(app != null) return;

  app = express();
  app.set('trust proxy', global.config.services.cdn.proxy?1:0);

  app.use(global.limiter.mid_ip);
  app.use(global.limiter.mid_url);
  app.use(global.limiter.mid_queue);
  app.use(global.router.mid_router);

  app.use(global.sessions.mid_csrf);
  app.use(global.responser.mid_compress);

  //404 ROUTE
  app.get('/404.htm|/*.404.htm',  async (req, res, next) => { global.cache.setCacheForever(res); return res.status(404).send(); });

  global.sessions.setup(app);

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

module.exports = setupExpressServer;