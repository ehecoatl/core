var scriptsLoaded = {loaded:0};
var scriptsInProgress = 0;
var scriptsInDefer = 0;
var scriptsTotal = 0;

var percentExplorerLoad = 0;
var targetPercent = 0;
var percentText = 0;

const splashUpdateLoad = () => {
    const _progress_bar = document.getElementById("progress-bar");
    if(!_progress_bar) return;
    requestAnimationFrame(()=>{
        targetPercent = parseInt(percentExplorerLoad*0.5 + (scriptsTotal > 0 ? 50-(scriptsInProgress/scriptsTotal)*50 : 0));
        _progress_bar.style.transform = `scaleX(${targetPercent/100})`;    
    });
}

window.splashLoader = () => {
    'use strict'
    
    var firstCheck = true;

    const splash_xhr = new XMLHttpRequest();
    const _progress_bar = document.getElementById("progress-bar");
    const _app_explorer = document.getElementById("app-explorer");
    const _splash_loader = document.getElementById("splash-loader");
    const _progress_text = document.getElementById("progress-text");
    const _progress_bar_bg = document.getElementById("progress-bar-bg");
    const _main_style_editor = document.getElementById("mainstyle");
    const _splash_loader_svg = document.getElementById("splash-loader-svg");

    const textIntervalFunction = ()=>{
        requestAnimationFrame(async ()=>{
            if(firstCheck){
                _progress_bar_bg.style.opacity = 1;
                _progress_text.style.opacity = 0;
                firstCheck = false;
                return;
            }

            if(scriptsLoaded.done) percentText = 100;
            else percentText += (targetPercent - percentText)*0.5;

            if((window.style_loaded??false) && (scriptsLoaded.done??false)){
                clearInterval(textInterval);

                /*WHOLE SCREEN*/
                _splash_loader.style.pointerEvents = "none";

                /*SVG*/
                //_splash_loader_svg.classList.add("rainbow");
                _splash_loader_svg.style.transition = "transform 2s ease-out, opacity 2s linear";
                _splash_loader_svg.style.transform = "translateY(-50px)";
                _splash_loader_svg.style.opacity = 0;

                /*P Text*/
                if(_progress_text.style.opacity > 0){  
                    _progress_bar.style.transform = `scaleX(1.0)`;
                    _progress_text.textContent = `100%`;
                    _progress_text.style.opacity = 0;
                }

                /*Bar BG*/
                _progress_bar_bg.style.opacity = 0;

                setTimeout(requestAnimationFrame,3000,()=>{
                    _splash_loader.remove(); //CLEAR LOADER
                    delete window.splashLoader;
                });
                return;
            }else if(percentText > 1){
                _progress_text.style.opacity = 1;
            }

            _progress_text.textContent = `${Math.round(percentText)}%`;
        });
    }
    const textInterval = setInterval(textIntervalFunction, 100);
    textIntervalFunction();

    const splashQueueScript = async (loadingScript, originScript) => {
        scriptsTotal++;
        scriptsInProgress++;

        if(loadingScript.getAttribute("defer")) {
            scriptsInDefer++;
            await promise_value(scriptsLoaded, 'deferred', true).then(()=>{
                //scriptsLoaded.deferred = false;
                scriptsInDefer--;
            });
            console.log("> LOADING -DEFER- "+loadingScript.src);
        }else{
            console.log("> LOADING START "+loadingScript.src);
        }

        originScript.parentNode.replaceChild(loadingScript, originScript);

        loadingScript.addEventListener("progress", (event) => {

        }, { passive: true });

        loadingScript.addEventListener("load", (event) => {
        	scriptsInProgress--;
            scriptsLoaded.loaded++;
        	console.log("> > LOADED "+event.target.src);
            splashUpdateLoad();
            if(scriptsInDefer + scriptsLoaded.loaded == scriptsTotal){
                scriptsLoaded.deferred = true;
                //if(scriptsInDefer == 0){
                promise_value(window, 'style_loaded').then(()=>{
                    scriptsLoaded.done = true;
                });
                //}
            }
        }, { passive: true });
    }

    splash_xhr.addEventListener("progress", (event) => {
        _splash_loader.classList.remove("hide_down");

        if (event.lengthComputable) {
            percentExplorerLoad = (event.loaded / event.total) * 100;
        }else{
            percentExplorerLoad = 100;
        }
        splashUpdateLoad();
    }, { passive: true });

    splash_xhr.addEventListener("load", async (event) => {
        if (splash_xhr.status === 200) {
        	console.log("LOADED EXPLORER "+event.target.responseURL);
            
            window.explorer_content = splash_xhr.responseText.cacheUUID();
            _app_explorer.innerHTML = window.explorer_content;

            /*Execute scripts within the loaded HTML*/
            const got_scripts = _app_explorer.querySelectorAll("script");
            got_scripts.forEach((s) => {
                const loadingScript = document.createElement("script");
                Array.from(s.attributes??[]).forEach((a) => loadingScript.setAttribute(a.name, a.value) );
                loadingScript.textContent = s.textContent; /*// if script is inline*/
                if(loadingScript.src) { splashQueueScript(loadingScript, s); }
                else{s.parentNode.replaceChild(loadingScript, s);}
            });
            splashUpdateLoad();

            const got_styles = _app_explorer.querySelectorAll("style");
            got_styles.forEach((s) => {
                const loadingStyle = document.createElement("style");
                Array.from(s.attributes??[]).forEach((a) => loadingStyle.setAttribute(a.name, a.value) );
                loadingStyle.textContent = s.textContent; /*// if script is inline*/
                try{
                    s.parentNode.replaceChild(loadingStyle, s);
                }catch(e){
                    console.error("SPLASH LOADER FAILED! ACTIVATING SCRIPT ERROR")
                    throw e;
                }
                if(loadingStyle.src) { splashQueueScript(loadingStyle); }
            });

            if(scriptsInDefer == scriptsTotal){
                scriptsLoaded.deferred = true;
                promise_value(window, 'style_loaded').then(()=>{
                    scriptsLoaded.done = true;
                });
            }

            const reloadStyle = document.createElement("style");
            Array.from(_main_style_editor.attributes??[]).forEach((a) => reloadStyle.setAttribute(a.name, a.value) );
            reloadStyle.textContent = _main_style_editor.textContent; /*// if script is inline*/
            _main_style_editor.remove();
            document.documentElement.appendChild(reloadStyle);

            window.updateLocale(null, false).then(()=>{
                window.translateContent("#app-explorer");

                const rep = `<svg xmlns="http://www.w3.org/2000/svg" version="2.0" width="1em" height="1em" class="d-inline-block"><use href="#{{id}}"></use></svg>`;
                document.querySelectorAll('i.bi').forEach(t => {
                    const c = t.getAttribute('class').replace(/^bi ([^\s]+)(.*)?$/g,'$1');
                    t.classList.remove(c);
                    t.innerHTML = rep.replace("{{id}}", c);
                });
                _app_explorer.dispatchEvent(new CustomEvent('explorer-loaded', {bubbles: true}));
                _app_explorer.style.display = null;

                promise_value(window, 'style_loaded').then(()=>{
                    requestAnimationFrame(()=>{
                        _progress_bar_bg.style.transition = "opacity 0.5s linear, transform 1s ease-out";
                        _progress_bar_bg.style.opacity = 0;
                        _progress_bar_bg.style.transform = "scaleX(0.2)";
                        _app_explorer.classList.remove('hide_down');
                        _app_explorer.dispatchEvent(new CustomEvent('explorer-show', {bubbles: true}));
                    });
                });
            });

        } else {
            console.error("Failed to load HTML:", splash_xhr.status);
        }
    }, { passive: false });

    /*splash_xhr.addEventListener("error", (event) => {
    	console.log("error");
    }, { passive: true });*/

    splash_xhr.open("GET", LOAD_EXPLORER.cacheUUID(), true);
    splash_xhr.send();

    for(let font of PRELOAD_FONTS){
        var link = document.createElement('link');
        link.rel = 'preload';
        link.href = font.href;
        link.as = 'font';
        link.type = font.type;
        link.crossOrigin = 'anonymous'; /*// or 'use-credentials' if applicable*/
        document.head.appendChild(link);
    }
};