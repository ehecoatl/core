const log_filename = global.config.log_filename;
const log_queue = {};

global.applogger = async (msg, name = "error", req = null) => {
	const date_full = global.now();
	const date_system = global.date_system();
	const path = ( req == null || !("dom_path" in req) ) ? `${global.main_path}/log` : `${req.dom_path}/_log`;
	const filename = log_filename
		.replace("{path}", path)
		.replace("{name}", name)
		.replace("{date}", date_system);

	log_queue[filename] = `${(log_queue[filename]??"")}[${date_full}] ${msg}\n`;
}



/* DOMAIN LOGGER UPDATE */
setInterval(async () => {
	for(const filename in log_queue){
		await global.fileAppendLineAsync(filename, log_queue[filename]);
		delete log_queue[filename];
	}
}, global.config.domain_log_interval??3000);
/* DOMAIN LOGGER UPDATE */



/* PM2 LOG TRUNCATE */
setInterval(async () => {
  try{
    await global.fsp.truncate(global.path.resolve(`./log/_pm2-out.log`));
    await global.fsp.truncate(global.path.resolve(`./log/_pm2-err.log`));
    //await updateCrawlerBotIps();
  }catch(e){
    console.error(e);
  }
}, global.config.log_clear_interval??120000);
/* PM2 LOG TRUNCATE */