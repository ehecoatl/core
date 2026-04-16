if(global.config.autobackup.enabled){

	global.archiver = global.archiver??require('archiver');
	global.Seven = global.Seven??require('node-7z');

	log("# AUTOBACKUP ENABLED!");

	const output_regexp = new RegExp(global.config.autobackup.output_filename
								.replace(".","\\.")
								.replace("{date}", "(?<date>[a-zA-Z0-9\\-]+)")
								.replace("{time}", "(?<time>[a-zA-Z0-9\\-]+)"));

	global.setInterval(async ()=>{
		const curdate = global.date_system();
		const curtime = global.time_system();
		const entries = await global.fsp.readdir(global.config.autobackup.output, { withFileTypes: true });
		const old_backups = {};

		console.log(`# BACKUP CLEANING 1 PER HOUR`);
		
		entries.sort((a, b) => a.name.localeCompare(b.name));

		for(const entry of entries) { 
			if(!entry.isFile()) continue;

			const match = entry.name.match(output_regexp);
			if(!match || !match.groups) continue;

			const time = match.groups.time.substring(0,2);
			if(!(match.groups.date in old_backups)) old_backups[match.groups.date] = {};
			if(!(time in old_backups[match.groups.date])) old_backups[match.groups.date][time] = [];
			old_backups[match.groups.date][time].push(entry.name);

			console.log(`# ${time} ${entry.name}`);
		}
		
		for(const d in old_backups){
			for(const t in old_backups[d]){
				for(let i=0, l=old_backups[d][t].length-1; i<l; i++){
					const file = `${global.config.autobackup.output}/${old_backups[d][t][i]}`;
					await global.fsp.unlink(file);
					console.log(`# BACKUP DELETED ${file}`);
				}
			}
		}

		console.log(`# BACKUP CLEANING 1 PER HOUR FINISH`);

	}, (global.config.autobackup.interval??3600000)*3, true);

	global.setInterval(()=>{
		console.log("# AUTOBACKUP START");

		try{
			const curdate = global.date_system();
			const curtime = global.time_system();
			const output_filename = global.config.autobackup.output_filename
										.replace("{date}", curdate)
										.replace("{time}", curtime);
			const myStream = global.Seven.add(
				`${global.config.autobackup.output}/${output_filename}`,
				global.config.autobackup.input,
				{ 
					recursive: true, mx: 9,
					exclude: global.config.autobackup.excludes
				}
			);
			myStream.on('end', function() { console.log('7Z Archive created'); });
			myStream.on('error', function(error) { console.error('7Z ERROR : ' + error); });
		}catch(e){
			console.error(e);
		}

		// const output = fs.createWriteStream(`${global.config.autobackup.output}/${output_filename}`);
		// const archive = archiver('zip', {
		//   zlib: { level: 9 } // Sets the compression level.
		// });

		// // listen for all archive data to be written
		// // 'close' event is fired only when a file descriptor is involved
		// output.on('close', function() {
		//   console.log(`# ${archive.pointer()} total bytes`);
		//   console.log(`# archiver has been finalized and the output file descriptor has closed.`);
		//   console.log("# AUTOBACKUP DONE");
		// });

		// // This event is fired when the data source is drained no matter what was the data source.
		// // It is not part of this library but rather from the NodeJS Stream API.
		// // @see: https://nodejs.org/api/stream.html#stream_event_end
		// output.on('end', function() {
		//   console.log('# Data has been drained');
		// });

		// // good practice to catch warnings (ie stat failures and other non-blocking errors)
		// archive.on('warning', function(err) {
		//   if (err.code === 'ENOENT') {
		//     // log warning
		//     console.log(`# ${err}`);
		//   } else {
		//     // throw error
		//     throw err;
		//   }
		// });

		// // good practice to catch this error explicitly
		// archive.on('error', function(err) {
		//   throw err;
		// });

		// // pipe archive data to the file
		// archive.pipe(output);

		// archive.glob('**/*', {
		//     cwd: global.config.autobackup.input, // The source directory to archive
		//     ignore: global.config.autobackup.excludes, // Patterns to exclude
		//     dot: true // Ensures dotfiles are included unless explicitly ignored
		// });

		// // finalize the archive (ie we are done appending files but streams have to finish yet)
		// // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
		// archive.finalize();
	}, global.config.autobackup.interval??3600000, true);
}