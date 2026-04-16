const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify: HTMLminify }  = require('html-minifier-terser');
const CSSMinify = require('csso');

const htmlMinifyOptions = {
    minifyCSS: true,         // Minify inline CSS in <style> tags
    minifyJS: true,          // Minify inline JavaScript in <script> tags
    removeComments: true,    // Remove HTML comments
    collapseWhitespace: true, // Collapse extra whitespace
    conservativeCollapse: true,
    removeAttributeQuotes: true,
    useShortDoctype: true
};

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

exports.genServeRoute = async function (req, res, route_object){
	const asset = route_object.asset;
	const locale_data = "locale_data" in route_object ? route_object.locale_data : null;
	const lang = "lang" in route_object ? route_object.lang : null;

	if(locale_data || lang){
		req.lang = lang ?? req.lang;
		return await renderLocaleFile(req, res, asset, "GET", locale_data);
	}else{
		return await serveAsset(req, res, asset);
	}
}

/*exports.genServeFile = async function (req, res, next) {
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

	await serveAsset(req, res, filename);
}

exports.genServeLocaleFile = async function (req, res, next) {
	var call = req.noQueryUrl.split("/");
	var filename = req.noQueryUrl.replace(/%20/g," ").replace(/^\/[a-z]{2}-[a-z]{2}\.([a-zA-Z0-9-_]{2,})\.([a-z0-9A-Z]{1,4})$/,"$1.$2");

	req.lang = req.noQueryUrl.replace(/^\/([a-z]{2}-[a-z]{2})\.[^\s]+$/,"$1");
	req.file = req.noQueryUrl.replace(/^\/[a-z]{2}-[a-z]{2}\.([a-zA-Z0-9-_]{2,})\.[^\s]*$/,"$1");

	if(call[1].endsWith(".manifest.json") || call[1].endsWith(".service-worker.js")) { filename = `sw/${filename}`; }
	else if(call[1].endsWith(".htm")) { filename = `html/${filename}`; }

	await renderLocaleFile(req, res, filename, "GET");
}*/

const localeReplacement = async function (path, ctx) {
	var locale_data = await global.fileReadAsync(path, "utf8", false);
	if(!locale_data) { console.error("REGEXP -- NOTFOUND -- "+path); return ctx; }

	try{ locale_data = JSON5.parse(locale_data); }
	catch(e){ console.error("REGEXP -- JSON ERROR -- "+path); return ctx; }

	/*for(let i in locale_data){
		ctx = ctx.replace(RegExp(`{{¡${i}!}}`,`g`), locale_data[i]);
	}*/
	return global.responser.Replacer.replaceOneShot(ctx, locale_data, "{{¡?!}}");
}

const insertIncludeCode = async function (rootpath, ctx) {
	const includesFound = [...ctx.matchAll(/{{include:([^\{\}\:\<\>\[\]]+)}}/gi)];
	for(const i of includesFound)
	{
		const file_content = await global.fileReadAsync(`${rootpath}/assets/${i[1]}`);
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

const renderLocaleFile = async function (req, res, filename, method="GET", data_translate=null) { //TODO: REPLACE STRINGS WITH META JSON
	const ext = global.path.extname(filename);
	const rootpath = global.path.resolve(req.root_path);

	if(!global.validMethod(method, req, res) ||
		await global.responser.checkLastMod(req, res, [`${rootpath}/${filename}`])) { return; }

	res.setHeader("Content-Type", global.config.file_extensions[ext]);

	const signature_data = {
		"lang":req.lang,
		"version": req.version,
		"last-origin-update":(req.lastModified??"no-cache"),
		"last-cdn-update":(new Date().toUTCString()),
		"last-req":req.originalUrl
	};

	var content = await global.fileReadAsync(`${rootpath}/${filename}`);
	content = global.responser.Replacer.replaceOneShot( content, signature_data, "{{¡?!}}" );
	
	if(!data_translate) data_translate = [];
	for(let i=0, l=data_translate.length; i<l; i++)
		content = await localeReplacement(`${rootpath}/${data_translate[i]}`, content);

	/*if(req.lang) { data_translate.push(`./locale/${req.lang}.json`); }
	if(ext.startsWith(".htm")){ data_translate.push(`./html/${req.file}_.${req.lang}.json`); }*/

	try{
		const cache_uuid = JSON5.parse(await global.router.cacheUUID(rootpath));
		content = global.responser.Replacer.replaceOneShot(content, cache_uuid, "{{¡uuid_?!}}");
	}catch(e){
		console.error(e);
	}

	/* INSERT INLINE SCRIPTS / HTML / CSS */
	content = await insertIncludeCode(rootpath, content);
	if(ext.startsWith(".htm")){ content = await HTMLminify(content, htmlMinifyOptions); }
	res.send(content);
}

const serveAsset = async function(req, res, filename){
	const rootpath = global.path.resolve(req.root_path);
	const f = filename.replace(/\.min\./,'.');
	const ext = global.path.extname(f);

	if(!global.validMethod("GET", req, res) ||
		await global.responser.checkLastMod(req, res, [`${rootpath}/${f}`])) { return; }

	res.setHeader("Content-Type", global.config.file_extensions[ext]);
	
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
		var content = await insertIncludeCode(rootpath, html_content);
		content = await HTMLminify(content, htmlMinifyOptions);
		return res.send(content);
	}

	const readableStream = global.fs.createReadStream(`${rootpath}/${f}`);
  	readableStream.on('error', (err) => { res.end(); console.error('Error reading file:', err); });
	readableStream.on('data', (chunk) => { res.write(chunk); });
  	readableStream.on('end', () => { res.end(); });
}