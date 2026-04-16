if(global.config.autobackup.enabled){

	global.archiver = global.archiver??require('archiver');

	log("# AUTOBACKUP ENABLED!");

	global.setInterval(()=>{
		console.log("# AUTOBACKUP START");

		const output_filename = global.config.autobackup.output
									.replace("{date}", global.date_system())
									.replace("{time}", global.time_system());
		const output = fs.createWriteStream(output_filename);
		const archive = archiver('zip', {
		  zlib: { level: 9 } // Sets the compression level.
		});

		// listen for all archive data to be written
		// 'close' event is fired only when a file descriptor is involved
		output.on('close', function() {
		  console.log(`# ${archive.pointer()} total bytes`);
		  console.log(`# archiver has been finalized and the output file descriptor has closed.`);
		  console.log("# AUTOBACKUP DONE");
		});

		// This event is fired when the data source is drained no matter what was the data source.
		// It is not part of this library but rather from the NodeJS Stream API.
		// @see: https://nodejs.org/api/stream.html#stream_event_end
		output.on('end', function() {
		  console.log('# Data has been drained');
		});

		// good practice to catch warnings (ie stat failures and other non-blocking errors)
		archive.on('warning', function(err) {
		  if (err.code === 'ENOENT') {
		    // log warning
		    console.log(`# ${err}`);
		  } else {
		    // throw error
		    throw err;
		  }
		});

		// good practice to catch this error explicitly
		archive.on('error', function(err) {
		  throw err;
		});

		// pipe archive data to the file
		archive.pipe(output);

		archive.glob('**/*', {
		    cwd: global.config.autobackup.input, // The source directory to archive
		    ignore: global.config.autobackup.excludes, // Patterns to exclude
		    dot: true // Ensures dotfiles are included unless explicitly ignored
		});

		// finalize the archive (ie we are done appending files but streams have to finish yet)
		// 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
		archive.finalize();
	}, global.config.autobackup.interval??60000, true);
}