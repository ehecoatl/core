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
 * env,
 * resources
 * }} param0 
 * @returns 
 */
ProcessForkRuntimePort.spawnAdapter = function ({
  path,
  cwd,
  variables,
  serialization,
  env,
  resources
}) {
  return fork(
    require.resolve(path),
    variables ?? [],
    {
      cwd,
      env,
      serialization: serialization ?? "advanced",
      execArgv: getExecArgv({ resources })
    }
  );
};

function getExecArgv({ resources }) {
  const nodeMaxOldSpaceSizeMb = Number(resources?.nodeMaxOldSpaceSizeMb);
  if (!Number.isInteger(nodeMaxOldSpaceSizeMb) || nodeMaxOldSpaceSizeMb <= 0) {
    return process.execArgv;
  }
  return [
    ...withoutMaxOldSpaceSizeArgs(process.execArgv),
    `--max-old-space-size=${nodeMaxOldSpaceSizeMb}`
  ];
}

function withoutMaxOldSpaceSizeArgs(args) {
  const filtered = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === `--max-old-space-size`) {
      index += 1;
      continue;
    }
    if (arg.startsWith(`--max-old-space-size=`)) {
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

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
