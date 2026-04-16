const queueFile = {};
const spliceFromArray = (arr, item) => { if((i = arr.indexOf(item)) > -1) return arr.splice(i, 1); else return false; };
const pollForValue = (conditionCheck, intervalMs, timeoutMs = 30000) => {
    return new Promise((resolve, reject) => {
        if (conditionCheck()) { return resolve(); }
        var timeout = 0;
        const intervalId = setInterval(() => {
            if (conditionCheck()) { clearInterval(intervalId); return resolve(); }
            else if((timeout = timeout + intervalMs) > timeoutMs) { clearInterval(intervalId); return reject(new Error("Polling timed out")); }
        }, intervalMs);
    });
}

exports.doneQueue = (filePath, taskId) => {
  if(queueFile[filePath][0] == taskId) { queueFile[filePath].shift(); }
  else { spliceFromArray(queueFile[filePath], taskId); }
  //console.log(`%% FREE QUEUE: ${taskId}`);
  return false;
}

exports.addQueue = async (filePath) => {
  if(!(filePath in queueFile)) queueFile[filePath] = [];
  const taskId = Date.now();
  queueFile[filePath].push(taskId);
  //console.log(`%% ADD QUEUE: ${taskId} - ${filePath}`);
  await pollForValue(() => queueFile[filePath][0] == taskId, 1000);
  //console.log(`%% CURRENT QUEUE: ${taskId}`);
  return taskId;
}