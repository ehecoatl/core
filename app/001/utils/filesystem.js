const {addQueue, doneQueue} = require("./filesystem-queue.js");

global.folderCreateAsync = async (...path) =>{
  try{
    for(let i=0, l=path.length; i<l; i++){
      const exist = await global.fileExistsAsync(path[i]);
      if (!exist) { await global.fsp.mkdir(path[i], { recursive: true }); }
    }
  }catch(error){
    throw error;
  }
}

global.fileExistsAsync = async (filePath, display=false) => {
  try {
    await global.fsp.access(filePath, fs.constants.F_OK);
    return true; // File exists
  } catch (error) {
    if (error.code === 'ENOENT' && display) { console.log(error); } // File does not exist 
    return false;
  }
}

global.fileStatAsync = async (filePath, display=false) => {
  try {
    return await global.fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' && display) { console.error(error); } // File does not exist 
    return false;
  }
}

global.fileReadAsync = async (filePath, encoding="utf8", display=true) => {
  const taskId = await addQueue(filePath);

  try {
    const content = await global.fsp.readFile(filePath, encoding);
    return doneQueue(filePath, taskId) || content;
  } catch (error) {
    if (error.code === 'ENOENT' && display) { console.error(error); } // File does not exist 
    return doneQueue(filePath, taskId);
  }
}

global.fileWriteAsync = async (filePath, data, encoding="utf8") => {
  const taskId = await addQueue(filePath);

  try {
    await global.fsp.writeFile(filePath, data, 'utf8');
    return doneQueue(filePath, taskId) || true;
  } catch (error) {
    if (error.code === 'ENOENT') { console.error(error); } // File does not exist 
    return doneQueue(filePath, taskId);    
  }
}

global.fileAppendLineAsync = async (filePath, line, encoding="utf8") => {
  const taskId = await addQueue(filePath);

  try {
    await global.fsp.appendFile(filePath, line, 'utf8');
    return doneQueue(filePath, taskId) || true;
  } catch (err) {
    console.error('Error appending to file:', err);
    return doneQueue(filePath, taskId);
  }
}