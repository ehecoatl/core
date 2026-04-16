function windowAddLink(options){
  for(const o of options){
    const link = document.createElement('link');
    link.rel = o.rel??'preload';
    link.href = (o.href).cacheUUID().replace("{{lang}}", WO.current_lang);
    link.crossOrigin = 'anonymous';
    if(o.as) link.as = o.as;
    if(o.type) link.type = o.type;
    if(o.sizes) link.sizes = o.sizes;
    if(o.onload) link.onload = o.onload;
    (o.appendTo??document.head).appendChild(link);
  }
}

function windowAddScript(options){
  for(const o of options){
    const scr = document.createElement('script');
    scr.src = (o.src).cacheUUID().replace("{{lang}}", WO.current_lang);
    if(o.async) scr.async = o.async;
    if(o.integrity) scr.integrity = o.integrity;
    scr.crossOrigin = o.crossOrigin??'anonymous'; 
    scr.onload = ()=>{
      if(splashUpdateLoad) { scriptsInProgress--;scriptsLoaded.loaded++;splashUpdateLoad(); }
      o.onload?.call();
    }

    (o.appendTo??document.head).appendChild(scr);
    
    scriptsInProgress++;scriptsTotal++;scriptsInDefer++;
  }
}
    
/*window.removeEventListener('DOMContentLoaded', startLoader);*/
window.UUID_DATA = WO.current_uuid_data;

windowAddLink(PRELOAD_LINKS);
windowAddScript(PRELOAD_SCRIPTS);

window.addEventListener('beforeinstallprompt', e => {
  console.log('beforeinstallprompt fired');
  window.deferredPrompt = e;
  e.preventDefault(); // Never ask user automatically?
});

document.addEventListener('explorer-show', (e) => {
  if (window.matchMedia("(display-mode: browser)").matches) {
    if(window.deferredPrompt){
      //There is a popup to show
      const installButton = document.getElementById("btn-pwa-install");
      installButton.classList.remove('d-none');
      installButton.href=`javascript:
      const installButton = document.getElementById('btn-pwa-install');
        installButton.classList.add('d-none'); 
        window.deferredPrompt.prompt(); 
        window.deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the A2HS prompt');
          } else {
            console.log('User dismissed the A2HS prompt');
            installButton.classList.remove('d-none');
          }
          window.deferredPrompt = null;
        });
      `.replace(/\r|\n/g,'');
      //After install
      window.addEventListener('appinstalled', () => {
        /*const installButton = document.getElementById("btn-pwa-install");
        console.log('PWA was installed');
        installButton.classList.add('d-none'); // Hide button after install
        if(!window.matchMedia("(display-mode: browser)").matches) return;
        const openAppButton = document.getElementById("btn-pwa-open");
        openAppButton.classList.remove('d-none');
        openAppButton.href = "web+wolimpapp://sidebutton";*/
      });
    }else{
      //There is no popup to show
      /*const openAppButton = document.getElementById("btn-pwa-open");
      openAppButton.classList.remove('d-none');
      openAppButton.href = "web+wolimpapp://sidebutton";*/
    }
  }
});

(async()=>{
  window.CURRENT_GLOBAL_UUID = JSON.stringify(window.UUID_DATA);

  try {
      const uuid_api_res = await callWolimpCloud('/uuid', "GET", {scope: 'explorer'});
      if (uuid_api_res) {
        window.UUID_DATA = { ...window.UUID_DATA, ...uuid_api_res };
        WO.current_uuid_data = window.UUID_DATA;
      }
  } catch (e) { console.error('Error fetching UUID data:', e); }


  window.UUID_CHANGED = (!CURRENT_GLOBAL_UUID || CURRENT_GLOBAL_UUID != JSON.stringify(window.UUID_DATA));
  if(window.UUID_CHANGED) {WO.current_uuid_data_before = 1;}

  if(window.UPDATE_FOUND) return;

  if(window.UUID_CHANGED || window.UUID_DATA.html != window.location.search.replace('?uuid=','')){
    window.location.replace(`?uuid=${window.UUID_DATA.html}`);
  }else{
    promise_value(window,'BetterScroll').then((bs)=>{
      try{BetterScroll.createBScroll('',null);}
      catch(e){}
    });

    window.UUID_CHANGED_BEFORE = (WO.current_uuid_data_before == 1);
    WO.current_uuid_data_before = null;

    promise_value(window, 'DOM_LOADED').then(()=>{
      window.splashLoader();
    });
  }
})();

(async()=>{
  var sw_registration;
  if ("serviceWorker" in navigator) {
    try {
      sw_registration = await navigator.serviceWorker.register(
        (SW_FILE??"/service-worker.js?uuid={{uuid_sw}}").cacheUUID(), 
        { scope: "/", }
      );

      //console.log(registration);
      if (sw_registration.installing) {
        console.log("Service worker installing");
        sw_registration.addEventListener("updatefound", async() => {
          console.log("Service Worker update found!");
          sw_registration.update();
          window.UPDATE_FOUND = true;
          await promise_value(window, 'UUID_CHANGED');
          window.location.replace(`?uuid=${window.UUID_DATA.html}`);
        });
      } else if (sw_registration.waiting) {
        console.log("Service worker installed");
      } else if (sw_registration.active) {
        console.log("Service worker active");
      }

      if(typeof onMessage !== "undefined") navigator.serviceWorker.onmessage = onMessage;

      await promise_value(sw_registration,'active').then((a)=> {
        a.postMessage({ message:"uuid", uuid:window.UUID_DATA });
        if (navigator.serviceWorker.controller === null) { a.postMessage({ message:"claimMe" }); }
      });

    } catch (error) {
      console.error(`Registration failed with ${error}`);
    }
  }else{
    console.error(`Service Worker not available`);
  }
})();