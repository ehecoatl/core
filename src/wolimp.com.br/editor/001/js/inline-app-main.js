const WO = new Proxy({},{
	get(obj, prop){
		return (prop in obj && typeof obj[prop].get === "function") ? obj[prop].get() : (obj[prop]??undefined);
	},
	set(obj, prop, value){ 
		if(prop in obj && typeof obj[prop].set === "function") {obj[prop].set(value)} else {obj[prop] = value};
		return true;
	},
});

WO.current_uuid_data_before = {
	label: "wo-uuid-data-before",
	get: function () { return window.localStorage.getItem(this.label)??null },
	set: function (value) { if(value == null) {window.localStorage.removeItem(this.label)} else {window.localStorage.setItem(this.label, value)} },
}

WO.current_uuid_data = {
	label: "wo-uuid-data",
	get: function () { return JSON.parse(window.localStorage.getItem(this.label) ?? `{ "js":"error", "sw":"error", "img":"error", "css":"error", "html":"error", "locale":"error" }`) },
	set: function (value) { window.localStorage.setItem(this.label, JSON.stringify(value)) },
}

WO.current_lang = {
	label: "wo-current-lang",
	get: function () { return window.localStorage.getItem(this.label) ?? document.documentElement.getAttribute('lang') },
	set: function (value) { window.localStorage.setItem(this.label, value) },
}

WO.current_tab = {
	label: "wo-current-tab",
	get: function () { return window.localStorage.getItem(this.label)??document.querySelector("#main-explorer-navbar .nav-link:first-child").id },
	set: function (value) { window.localStorage.setItem(this.label, value) },
}

WO.current_theme = {
	label: "wo-theme-option",
	get: function () { return window.localStorage.getItem(this.label) ?? "auto" },
	set: function (value) { window.localStorage.setItem(this.label, value) },
}

document.addEventListener('contextmenu', event => {
	event.preventDefault();
	document.dispatchEvent(new CustomEvent('explorer-contextmenu', {bubbles: false}));
}, { passive: false });

// javascript-obfuscator:disable
String.prototype.escape2RegExp = function() { return this.replace(/([\.\*\+\?\^\$\{\}\(\)\[\]\\])/g, '\\$1'); }; // | missing
// javascript-obfuscator:enable

String.prototype.replaceK2V = function(source_obj, key_mask = null, replace_mask = null) {
  if(!source_obj || typeof source_obj !== "object" || key_mask == "" || replace_mask == "") return this;

  const values = {}
  const replacer = (!replace_mask || typeof replace_mask !== "string") ?
    (...args) => values[args[0]] : 
    (...args) => replace_mask.replace("?",values[args[0]]);

  const regex_keys = [];
  for(const k in source_obj){
    if(typeof k !== "string" || k.length == 0) continue;
    const key = (!key_mask || typeof key_mask !== "string") ? k : key_mask.replace("?",k);
    values[key] = source_obj[k];
    regex_keys.push(key);
  }
  return regex_keys.length == 0 ? this : this.replace(
    new RegExp(`(${regex_keys.join("|").escape2RegExp()})`, "g"), 
    replacer
  );
}

String.prototype.cacheUUID = function() { return this.replaceK2V(window.UUID_DATA, '{{uuid_?}}'); };

var wo_font_size = window.localStorage.getItem('wo-font-size')??1.0;
document.addEventListener("DOMContentLoaded", (e)=>fontChange(0));
const fontChange = (val) => {
	wo_font_size = parseFloat(wo_font_size) + val;
	if(wo_font_size > 1.2) { wo_font_size = 1.2; }
	else if(wo_font_size <= 0.8) { wo_font_size = 0.8; }
	window.localStorage.setItem('wo-font-size', wo_font_size);
	document.documentElement.style.fontSize = `${wo_font_size}rem`;
}

const promise_value = async (scope, variable_name, value, tick_ms, timeout) => {
	scope = (scope??globalThis);
	return scope[variable_name??"variable"] ?? await _promise_value_assist(scope, variable_name??"variable", value??undefined, tick_ms??100, timeout??60*1000);
}

const _promise_value_assist = async (scope, variable_name, value, tick_ms, timeout) => {
	await new Promise( (resolve,reject) => {
        var interval = setInterval(() => {
            if (variable_name in scope && (
            	(value != undefined && scope[variable_name] == value) || 
            	(value == undefined && scope[variable_name] != undefined)
            	)) { 
            	clearInterval(interval);
            	resolve();
            }
            timeout -= tick_ms;
            if(timeout <= 0){
            	clearInterval(interval);
            	reject(new Error("Promise value '"+variable_name+"' timeout "));
            }
        }, tick_ms);
    });
    return scope[variable_name]??undefined;
}

WO.ZLIB = {
	gzip64: (str) => {
	  const compressedUint8Array = window.pako.deflate(str);
	  const binaryString = String.fromCharCode.apply(null, compressedUint8Array);
	  const base64String = btoa(binaryString);
	  return base64String;
	},
	ungzip64: (base64String) => {
	  const decodedBinaryString = atob(base64String);
	  const decodedUint8Array = new Uint8Array(decodedBinaryString.split('').map(char => char.charCodeAt(0)));
	  const decompressedText = window.pako.inflate(decodedUint8Array, { to: 'string' });
	  return decompressedText;
	}
};
window.ZLIB = WO.ZLIB;

(async () => { 
	await promise_value(window, "pako");

	var _timeout = null;
	const _prop = "localData";
	const _label = "wo-data";
	const _saver = {
		set(obj, prop, value){
			if(obj[prop]??undefined == value) return;
			obj[prop] = value;
			console.log("<<>> CHANGED");
			_save();
		},
		get(obj, prop) { return obj[prop] ?? undefined },
	}

	//console.log("<<>> LOADED");
	const _data64 = window.localStorage.getItem(_label)??ZLIB.gzip64("{}");
	const _data = JSON.parse(ZLIB.ungzip64(_data64));
	WO[_prop] = new Proxy(_data, _saver );

	const _save = () => {
		clearTimeout(_timeout??0);
		_timeout = setTimeout(_save_assist, 250);
		//console.log("<<>> SAVE");
	}

	const _save_assist = ()=>{
		window.localStorage.setItem(_label, ZLIB.gzip64(JSON.stringify(_data)));
		//Toast local data saved
		console.log("<<>> SAVE ASSIST");
	};

})()