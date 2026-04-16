window.updateLocale = async (language, auto = true) => {
	const lang = language??WO.current_lang;
    try {
    	document.getElementById('btn-locale')?.classList.add('inset-loading');
    	await new Promise((resolve)=>setTimeout(resolve,100));
        const locale_url = LOAD_LOCALE.replace(/{{lang}}/g, lang).cacheUUID();
        const locale_data = await fetch(locale_url);
        if (locale_data.ok) {
            const loaded_json = await locale_data.json();
            delete window.LANG;
            window.LANG = loaded_json;
            document.documentElement.setAttribute('lang', lang);
            console.log(`[Lang] ${locale_url} loaded successfully`);
            if(auto) {
            	await window.translateContent();
            	WO.current_lang = lang;
            }
        }else{
            console.error('Error loading different locale');
			document.getElementById('btn-locale')?.classList.remove('inset-loading');
        }
    } catch (e) { console.error('Error fetching locale data:', e); }
};

window.translateContent = async (parentSelector=null) => {
	const lang = WO.current_lang;
    const lang_name = document.querySelector(`[data-locale='${lang}']`).getAttribute('aria-label');

    const originalLang = document.documentElement.getAttribute('lang-original');
    if(originalLang){
    	document.querySelector(`[data-locale='${originalLang}'] span`).style.fontWeight = "bold";
	}

    document.getElementById('btn-locale')?.querySelector('svg use').setAttribute('href',`#${lang}`);
    document.querySelectorAll('.lang-name').forEach((s)=> s.innerHTML = lang_name );
	document.getElementById('btn-locale')?.classList.remove('inset-loading');
    await new Promise((resolve)=>setTimeout(resolve,100));
	
	if(parentSelector) { parentSelector += ` `; }
	document.querySelectorAll(`${parentSelector??""}span[lang]:not([lang="${lang}"])`).forEach((c)=>{
		const id = c.getAttribute("data-locale-id")??c.innerText.replace(/\t|\r|\n/g,' ').replace(/\s{2,}/g,' ').trim().toLowerCase();
		if(id in window.LANG){
			c.innerHTML = window.LANG[id];
			c.setAttribute("data-locale-id", id);
			c.setAttribute("lang", lang);
			c.style.letterSpacing = c.getAttribute(`data-ls-${lang}`);
		}
	});
	
	document.querySelectorAll(`${parentSelector??""}span[lang-date]:not([lang="${lang}"])`).forEach((c)=>{
		window.translateDate(c);
	});
};

window.translateDate = async (node) =>{
	await promise_value(window, 'luxon');
	const lang = WO.current_lang;
	const date = luxon.DateTime.fromISO(node.getAttribute('lang-date'));
	const format = date.hasSame(luxon.DateTime.now(), 'day') ? luxon.DateTime.TIME_SIMPLE : luxon.DateTime.DATETIME_MED;
	node.innerHTML = date.setLocale(lang).toLocaleString(format);
	node.setAttribute("lang", lang);
	node.style.letterSpacing = node.getAttribute(`data-ls-${lang}`);
}

document.addEventListener("DOMContentLoaded", function(e){
	const langWatchTargetNode = document.body; 
	const langWatchConfig = { childList: true, subtree: true }; 
	const langWatchCallback = (mutationList, observer) => {
	  const lang = document.documentElement.getAttribute('lang');
	  for (const mutation of mutationList) {
	    if (mutation.type === 'childList') {
	    	for (const node of mutation.addedNodes) {
		        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN'
		        	&& node.hasAttribute('lang-date') 
		        	&& node.getAttribute('lang') != lang) {
		          	window.translateDate(node);
		        }
		  	}
	    }
	  }
	};
	const langWatchObserver = new MutationObserver(langWatchCallback);
	langWatchObserver.observe(langWatchTargetNode, langWatchConfig);
});