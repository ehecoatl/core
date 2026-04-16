const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify: HTMLminify }  = require('html-minifier-terser');
const CSSMinify = require('csso');
const { v4: genuuid } = require('uuid');

const jsObfuscationOptions = {
/**/compact: true,
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    domainLock: [],
    domainLockRedirectUrl: 'about:blank',
    forceTransformStrings: [],
    identifierNamesCache: null,
    identifierNamesGenerator: 'mangled',
    identifiersDictionary: [],
    identifiersPrefix: '',
    ignoreImports: false,
    inputFileName: '',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
/**/renameProperties: false,
    renamePropertiesMode: 'safe',
    reservedNames: [],
    reservedStrings: [],
    seed: 0,
    selfDefending: false,
/**/simplify: true,
    sourceMap: false,
    sourceMapBaseUrl: '',
    sourceMapFileName: '',
    sourceMapMode: 'separate',
    sourceMapSourcesMode: 'sources-content',
    splitStrings: false,
    splitStringsChunkLength: 10,
/**/stringArray: false,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: [],
    stringArrayIndexesType: [
        'hexadecimal-number'
    ],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayWrappersType: 'variable',
    stringArrayThreshold: 0.75,
    target: 'browser',
    transformObjectKeys: false,
    unicodeEscapeSequence: false
};

global.HTML_UUID = "";

global.setNoCache = (res) => res.setHeader("Cache-Control", "no-cache");
global.setCacheForever = (res) => global.setCache(res, 31536000, 31536000, "immutable");
global.setCache = (res,  browser_ttl=60, cdn_ttl=null, add=null) => {
	res.setHeader("Cache-Control", `${cdn_ttl?`public, s-maxage=${cdn_ttl},`:`private,`} max-age=${browser_ttl}, stale-while-revalidate=${browser_ttl}, stale-if-error=${browser_ttl} ${add?`,${add}`:''}`);
}

global.validMethod = (method, req, res) => {
	const m = req.method == method;
	if(!m) { res.status(405).end(); }
	return m;
}

//CHECK FOR VALID TOKEN IN CURRENT REQUEST
global.checkCSRF = (req, res, next) => {
	const token_id = `axis-csrf-token`;
	if(req.session[token_id] != req.cookies[encodeURIComponent(token_id)]){
		return global.default403(req, res, "INVALID CSRF TOKEN SENT IN COOKIE"); 
	}
	//ALLOW ACTION, BUT GENERATES ANOTHER CSRF FOR NEXT CALLS
	global.generateCSRF(req, res);
	next();
}

//GENERATE NEW TOKEN
global.generateCSRF = (req, res) => {
	const token_id = `axis-csrf-token`;
	req.session[token_id] = genuuid();
	res.cookie(encodeURIComponent(token_id), req.session[token_id], global.safe_cookie_config);
}

global.default404 = async (req, res, message = "") =>{
	//res.status(404).end();
	const lang_prefix = req.lang ? `${req.lang}.` : '';
	global.setCacheForever(res);
	res.redirect(301, `/${lang_prefix}404.htm`);
	console.error(`E-> 404 -> ${req.get('host')}${req.originalUrl} : ${message}`);
	global.applogger(`${req.get('host')}${req.originalUrl} : ${message}`, '404');
	
	const user_ip = global.config.cloudflare == true ? req.headers['cf-connecting-ip'] : req.connection.remoteAddress;
	if(!(user_ip in global.errored_ips)) { global.errored_ips[user_ip] = []; }
	global.errored_ips[user_ip].push(`${req.noQueryUrl}`);
	await global.fileWriteAsync(
		global.errored_ips_file,
		JSON.stringify(global.errored_ips)
	);
}

global.default403 = async (req, res, message = "") =>{
	console.error(`E-> 403 -> ${req.originalUrl} : ${message}`);
	res.status(403).end();
}

global.genServeFile = async (req, res, next) => {
	var call = req.noQueryUrl.split("/");
	var filename = req.noQueryUrl.replace("assets/","").replace(/%20/g," ").replace(/^\//,"");

	if(call.length == 2){
		switch(call[1]){
			case "favicon.ico":
				filename = `img/${filename}`;
				break;
			case "robots.txt":
			case "sitemap.xml":
				filename = `sw/${filename}`;
				break;
		}
	}

	const version = get_route(`${req.request_sub}.${req.request_domain}`);
	const rootpath = global.path.resolve(req.root_path);

	await global.serveAsset(req, res, rootpath, filename);
}

global.genServeLocaleFile = async (req, res, next) => {
	var call = req.noQueryUrl.split("/");
	var filename = req.noQueryUrl.replace(/%20/g," ").replace(/^\/[a-z]{2}-[a-z]{2}\.([a-zA-Z0-9-_]{2,})\.([a-z0-9A-Z]{1,4})$/,"$1.$2");

	req.lang = req.noQueryUrl.replace(/^\/([a-z]{2}-[a-z]{2})\.[^\s]+$/,"$1");
	req.file = req.noQueryUrl.replace(/^\/[a-z]{2}-[a-z]{2}\.([a-zA-Z0-9-_]{2,})\.[^\s]*$/,"$1");

	if(call[1].endsWith(".manifest.json") || call[1].endsWith(".service-worker.js")) { filename = `sw/${filename}`; }
	else if(call[1].endsWith(".htm")) { filename = `html/${filename}`; }

	const version = get_route(`${req.request_sub}.${req.request_domain}`);
	const rootpath = global.path.resolve(req.root_path);

	await global.renderLocaleFile(req, res, rootpath, filename, "GET");
}

global.localeReplacement = async (path, ctx) => {
	var locale_data = await global.fileReadAsync(path, "utf8", false);
	if(!locale_data) { console.error("REGEXP -- NOTFOUND -- "+path); return ctx; }

	try{ locale_data = JSON.parse(locale_data); }
	catch(e){ console.error("REGEXP -- JSON ERROR -- "+path); return ctx; }

	/*for(let i in locale_data){
		ctx = ctx.replace(RegExp(`{{¡${i}!}}`,`g`), locale_data[i]);
	}*/
	return global.replaceK2V(ctx, locale_data, "{{¡?!}}");
}

global.insertIncludeCode = async (rootpath, ctx) => {
	const includesFound = [...ctx.matchAll(/{{include:([^\{\}\:\<\>\[\]]+)}}/gi)];
	for(const i of includesFound)
	{
		const file_content = await global.fileReadAsync(`${rootpath}/${i[1]}`);
		const ext = global.path.extname(i[1]);
		switch(ext){
			case ".js": 
				const ob = JavaScriptObfuscator.obfuscate( file_content, jsObfuscationOptions );
				ctx = ctx.replace(i[0], `${ob.getObfuscatedCode()}`);
				break;
			case ".css":
				const min = CSSMinify.minify( file_content );
				ctx = ctx.replace(i[0], `${min.css}`); 
				break;
			case ".htm": ctx = ctx.replace(i[0], file_content); break;
		}
	}
	return ctx;
}

global.renderLocaleFile = async (req, res, rootpath, filename, method="GET") => { //TODO: REPLACE STRINGS WITH META JSON
	const ext = global.path.extname(filename);

	if(!global.validMethod(method, req, res) ||
		await global.checkLastMod(req, res, [`${rootpath}/${filename}`])) { return; }

	res.setHeader("Content-Type", global.config.file_extensions[ext]);
	//global.cacheUUID(rootpath, filename.split("/")[0]); // Already happening on CF calls

	var content = await global.fileReadAsync(`${rootpath}/${filename}`);

	content = global.replaceK2V(
		content,
		{
			"lang":req.lang,
			"version": req.version,
			"last-origin-update":(req.lastModified??"no-cache"),
			"last-cdn-update":(new Date().toUTCString()),
			"last-req":req.originalUrl
		},
		"{{¡?!}}"
	);
	content = await global.localeReplacement(`${rootpath}/locale/${req.lang}.json`, content); // locale base
	content = await global.localeReplacement(`${rootpath}/html/${req.file}_.${req.lang}.json`, content); // locale specifics

	try{
		const cache_uuid = JSON.parse(await global.cacheUUID(rootpath));
		content = global.replaceK2V(content, cache_uuid, "{{¡uuid_?!}}");
	}catch(e){
		console.error(e);
	}

	/* INSERT INLINE SCRIPTS / HTML / CSS */
	content = await global.insertIncludeCode(rootpath, content);
	
	if(ext == ".htm"){
		content = await HTMLminify(content, {
	        minifyCSS: true,         // Minify inline CSS in <style> tags
	        minifyJS: true,          // Minify inline JavaScript in <script> tags
	        removeComments: true,    // Remove HTML comments
	        collapseWhitespace: true, // Collapse extra whitespace
	        conservativeCollapse: true,
	        removeAttributeQuotes: true,
	        useShortDoctype: true
	    });
	}
	
	//res.setHeader('File-Size', Buffer.byteLength(content));
	res.send(content);
}

global.serveAsset = async (req, res, rootpath, filename) => {
	const f = filename.replace(/\.min\./,'.');
	const ext = global.path.extname(f);

	if(!global.validMethod("GET", req, res) ||
		await global.checkLastMod(req, res, [`${rootpath}/${f}`])) { return; }

	res.setHeader("Content-Type", global.config.file_extensions[ext]);
	//global.cacheUUID(rootpath, f.split("/")[0]); // Already happening on CF calls
	
	if(/\.min\./.test(filename)){
		switch(ext){
			case ".js":
				const js_content = await global.fileReadAsync(`${rootpath}/${f}`);
				const ob = JavaScriptObfuscator.obfuscate( js_content, jsObfuscationOptions );
				const c = ob.getObfuscatedCode();
				return res.send(c);
				break;

			case ".css":
				const css_content = await global.fileReadAsync(`${rootpath}/${f}`);
				const min = CSSMinify.minify( css_content );
				return res.send(min.css);
				break;
		}
	}

	if(ext.startsWith(".htm")){
		/* INSERT INLINE SCRIPTS / HTML / CSS */
		const html_content = await global.fileReadAsync(`${rootpath}/${f}`);
		var content = await global.insertIncludeCode(rootpath, html_content);
		content = await HTMLminify(content, {
	        minifyCSS: true,         // Minify inline CSS in <style> tags
	        minifyJS: true,          // Minify inline JavaScript in <script> tags
	        removeComments: true,    // Remove HTML comments
	        collapseWhitespace: true, // Collapse extra whitespace
	        conservativeCollapse: true,
	        removeAttributeQuotes: true,
	        useShortDoctype: true
	    });
		return res.send(content);
	}

	const readableStream = global.fs.createReadStream(`${rootpath}/${f}`);
  	readableStream.on('error', (err) => { res.end(); console.error('Error reading file:', err); });
	readableStream.on('data', (chunk) => { res.write(chunk); });
  	readableStream.on('end', () => { res.end(); });
}

global.checkLastMod = async (req, res, etag_check_files = []) => {
	if(global.config.debug_no_cache === true) return;

	const ifms = req.headers["if-modified-since"] ?? null;
	//global.log(`Access to ${req.url} - If modified since ${ifms??'-'}`);

	var latest = new Date(ifms ?? "1990-01-01 00:00:00");
	for(let f of etag_check_files){
		// let exists = await global.fileExistsAsync(f);
		// if(!exists) { res.status(404).end();return true; } //Doesn't exist
		let stat = await global.fileStatAsync(f);
		if(!stat || stat.isDirectory()) { global.default404(req, res, "FILE NOT FOUND WHEN CHECKING FOR CACHE"); return true; } //Accessing directory

		try{
			let d = stat.mtime;
			if(d.getTime() > latest.getTime()) latest = d;
		}catch(e){
			global.default404(req, res, "INVALID FILE TIME");
			return true;
		}
	}
	latest.setMilliseconds(0);

	req.lastModified = latest.toUTCString();
	res.setHeader('Last-Modified', req.lastModified);

	if (ifms && new Date(ifms).getTime() >= latest.getTime()) {
		res.status(304).end();
		if(global.config.log_cache) { global.log(`> Not Modified 304 -> ${req.originalUrl}`); }
		return true;
	}

	if(global.config.log_cache) { global.log(`-> Serve Data -> ${req.originalUrl}`); }

	const smaxage = global.config.cdn_cache_seconds; //TTL CDN
	const bmaxage = global.config.browser_cache_seconds; //TTL Browser
	
	global.setCache(res, bmaxage, smaxage);

	return false;
}

global.cacheUUID = async (rootpath, update_tag=null) => {
	var fileContent = await global.fileReadAsync(global.path.resolve(`${rootpath}/uuid`));
	var changed = false;
	if(!fileContent){//generate new uuid
		fileContent = JSON.stringify({
			"js": genuuid(),
			"sw": genuuid(),
			"img": genuuid(),
			"css": genuuid(),
			"html": genuuid(),
			"models": genuuid(),
			"locale": genuuid()
		});
		changed = true;
	}else if(update_tag){
		fileContent = JSON.parse(fileContent);
		if(typeof update_tag == "string"){
			fileContent[update_tag] = genuuid();
		}else{
			for(const i of update_tag) { fileContent[i] = genuuid(); }
		}
		fileContent = JSON.stringify(fileContent);
		changed = true;
		global.log(`CACHE UUID UPDATED FOR ${typeof update_tag == "string" ? update_tag : update_tag.join(',')}`);
	}

	if(changed){
		await global.fileWriteAsync(
			global.path.resolve(`${rootpath}/uuid`),
			fileContent
		);
	}

	return fileContent;
}