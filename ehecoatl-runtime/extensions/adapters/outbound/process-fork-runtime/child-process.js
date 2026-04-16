// adapters/outbound/process-fork-runtime/child-process.js


'use strict';


const ProcessForkRuntimePort = require(`@/_core/_ports/outbound/process-fork-runtime-port`);
const { fork } = require("child_process");

ProcessForkRuntimePort.currentProcessAdapter = function () { return process; };

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
ProcessForkRuntimePort.spawnAdapter = function ({
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

ProcessForkRuntimePort.initAdapter = function ({
  managedProcess,
  onExitCallback,
  onMessageToRootCallback,
}) {
  managedProcess.process.on("message", onMessageToRootCallback);
  managedProcess.process.on("exit", onExitCallback);
};

module.exports = ProcessForkRuntimePort;
Object.freeze(ProcessForkRuntimePort);
