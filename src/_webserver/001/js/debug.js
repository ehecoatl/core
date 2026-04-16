const log_filename = "log_{date}_{name}.txt";
const log_queue = {};

global.applogger = async (msg, name = "error") => {
	const date = new Date();
	const date_full = date.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'});
	const filename = log_filename
	.replace("{name}", name)
	.replace("{date}", date.toISOString().slice(0, 10));

	log_queue[filename] = `${(log_queue[filename]??"")}[${date_full}] ${msg}\n`;
}

async function applogger_update(){
	for(let filename in log_queue){
		await global.fileAppendLineAsync(`${global.main_path}/logs/${filename}`, log_queue[filename]);
		delete log_queue[filename];
	}
}

setInterval(applogger_update, 30*1000);