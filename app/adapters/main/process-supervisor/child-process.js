// adapters/main/process-supervisor/child-process.js


'use strict';


const ProcessSupervisorAdapter = require(`g@/main/process-supervisor/process-supervisor-adapter`);
const { fork } = require("child_process");

ProcessSupervisorAdapter.currentProcessAdapter = function () { return process; };

/* -----------------------------
   SPAWN ADAPTER
------------------------------ */

/**
 * 
 * @param {{
 * path,
 * cwd,
 * variables,
 * serialization,
 * env
 * }} param0 
 * @returns 
 */
ProcessSupervisorAdapter.spawnAdapter = function ({
  path,
  cwd,
  variables,
  serialization,
  env
}) {
  return fork(
    require.resolve(path),
    variables ?? [],
    {
      cwd,
      env,
      serialization: serialization ?? "advanced"
    }
  );
};

/* -----------------------------
   INITIALIZE ADAPTER
------------------------------ */

ProcessSupervisorAdapter.initAdapter = function ({
  managedProcess,
  onExitCallback,
  onMessageToRootCallback,
}) {
  managedProcess.process.on("message", onMessageToRootCallback);
  managedProcess.process.on("exit", onExitCallback);
};

module.exports = ProcessSupervisorAdapter;
Object.freeze(ProcessSupervisorAdapter);
