global.fileExistsAsync = async (filePath) => {
  try {
    await global.fsp.access(filePath);
    return true; // File exists
  } catch (error) {
    if (error.code === 'ENOENT') { return false; } // File does not exist 
    throw error;
  }
}

global.fileStatAsync = async (filePath) => {
  try {
    return await global.fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') { console.error(error); } // File does not exist 
    return false;
  }
}

global.fileReadAsync = async (filePath, encoding="utf8", display=true) => {
  try {
    return await global.fsp.readFile(filePath, encoding);
  } catch (error) {
    if (error.code === 'ENOENT' && display) { console.error(error); } // File does not exist 
    return false;
  }
}
global.fileWriteAsync = async (filePath, data, encoding="utf8") => {
  try {
    await global.fsp.writeFile(filePath, data, 'utf8');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') { console.error(error); } // File does not exist 
    return false;
  }
}
global.fileAppendLineAsync = async (filePath, line, encoding="utf8") => {
  try {
    // Append the line followed by a newline character
    await global.fsp.appendFile(filePath, line, 'utf8');
    return true;
  } catch (err) {
    console.error('Error appending to file:', err);
    return false;
  }
}