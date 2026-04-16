const queueFile = {};
const getTaskId = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Date.now() - d.getTime(); // Integer timestamp
}
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
  const s = queueFile[filePath];
  if(s[0] === taskId) { s.shift(); }
  else { spliceFromArray(s, taskId); }
  //console.log(`%% FREE QUEUE: ${taskId}`);
  return false;
}

exports.addQueue = async (filePath) => {
  if(!(filePath in queueFile)) queueFile[filePath] = [];
  const s = queueFile[filePath];
  const taskId = getTaskId();
  s.push(taskId);
  //console.log(`%% ADD QUEUE: ${taskId} - ${filePath}`);
  await pollForValue(() => s[0] === taskId, 1000);
  //console.log(`%% CURRENT QUEUE: ${taskId}`);
  return taskId;
}