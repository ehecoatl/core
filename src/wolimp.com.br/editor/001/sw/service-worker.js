var dataUUID = null;
const data_queue = [];

const cloudPrefix = "/cloud/";
const requestTimeout = 10*1000;
const netStatus = { online:false, waiting_data:0 };
const CacheCurrentVersion = "wolimp_editor6_{{¡last-origin-update!}}";
/*const preCachedResources = [
  "/{{¡lang!}}.index.htm",
  "/assets/js/app-install.min.js",
  "/assets/js/app-splash-loader.min.js",
  "/assets/html/index_explorer.htm",

];*/
const FallbackUrl = "/{{¡lang!}}.index.htm";

/*const preCache = async () => { return; const c = await caches.open(CacheCurrentVersion); return c.addAll(preCachedResources); };*/
const postCache = async (request, response_clone) => { const c = await caches.open(CacheCurrentVersion); return c.put(request, response_clone); };
const deleteKeyFromCache = async (key) => { await caches.delete(key); };

const clearOldCache = async () => {
  const allKeys = await caches.keys();
  const keysToDelete = allKeys.filter((key) => CacheCurrentVersion != key);
  await Promise.all(keysToDelete.map(deleteKeyFromCache));
};

/*const enablePreload = async () => {
  if (!self.registration.navigationPreload) return;
  await self.registration.navigationPreload.enable();
};*/

const putInCache = async (request, response) => {
  const cache = await caches.open(CacheCurrentVersion);
  await cache.put(request, response);
};

const fallbackResponse = async () =>{
  const resFall = await caches.match(FallbackUrl);
  if (resFall) {
    return resFall;
  } else {
    return new Response("Verifique sua conexao com a internet", {
      status: 408,
      headers: { "Content-Type": "text/plain" },
    });
  }
};

const cacheResponse = async (request) => {
  const resCache = await caches.match(request);
  if(resCache) return resCache;
  else return null;
};

const defaultResponse = async (event) => {
  var new_request = null;
  const request = event.request;

  //const clean_request = new Request(request.url.replace(/(\?.*)|(#.*)/g, ""));
  /*if(dataUUID && clean_request.url.indexOf("wolimp.com.br") > -1){
    var new_request = null, asset_address = null;
    if(clean_request.url.endsWith('.htm')){ 
      new_request = new Request(`${clean_request.url}?uuid=${dataUUID.html}`);
    }else if(clean_request.url.endsWith('service-worker.js') || clean_request.url.endsWith('.manifest.json')){ 
      new_request = new Request(`${clean_request.url}?uuid=${dataUUID.sw}`);
    }else if(asset_address = clean_request.url.match(/\/assets\/([a-z]+)\//)){
      new_request = new Request(`${clean_request.url}?uuid=${dataUUID[asset_address[1]]}`); 
    }
  }*/

  const def_request = (new_request??request);

  const fetchCall = fetch(def_request, { signal: AbortSignal.timeout(requestTimeout) })
    .then(async (response) => {
      if(def_request.url.indexOf(cloudPrefix) == -1 && dataUUID) { await postCache(def_request, response.clone()); }
      return response;
    }).catch(async (err) => {
      if(def_request.url.indexOf(cloudPrefix) == -1){
        const cache_run = await cacheResponse(def_request);
        if(cache_run != null) return cache_run;
      }

      return new Response(JSON.stringify({success:false, code:0, message:"Sem conexão com a internet.", error:err}), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-cache" },
      });
    });
  
  /*STALE SERVE WHEN NEW VERSION FOUND*/

  return fetchCall;
};

self.addEventListener("install", (event) => { self.skipWaiting(); /*event.waitUntil(preCache());*/ });
self.addEventListener("fetch", (event) => { event.respondWith(defaultResponse(event)); });
self.addEventListener("activate", (event) => { event.waitUntil(clearOldCache());  });
self.addEventListener("message", (event) => {
  const data = event.data;
  switch(data.message){
    case "data": data_queue.push(data); break;
    case "clear": data_queue.splice(0,data_queue.length); break;
    case "claimMe": self.clients.claim(); break;
    case "uuid": dataUUID = data.uuid; console.log(dataUUID); break;
  }
});