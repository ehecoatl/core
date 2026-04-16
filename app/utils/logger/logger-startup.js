// utils/logger-startup.js


'use strict';


const { logColor, errorColor, logBR, boldFormat, titleFormat } = require(
  `@/utils/logger/log-format`,
);

var startUpIndent = 0;

const delay = (t) => new Promise((r) => setTimeout(r, t));

function getStartUpIndent(val) {
  return " ".repeat(val ?? startUpIndent);
}

module.exports.intro = function () {
  const pjson = require("@package.json");
  return new Promise(async (resolve) => {
    await delay(1000);

    logColor(`${new Date().toLocaleString()}`, `yellow`);
    await delay(500);

    logColor(`${process.pid}: ${process.title} ${process.version}`, `yellow`);
    await delay(500);

    logBR(1);
    const format = { font: `Double`, horizontalLayout: `fitted` };
    const title = titleFormat(pjson.name, format);
    logColor(boldFormat(title), `white`, `yellow`);
    await delay(500);

    logBR(1);
    logColor(`${pjson.name} v${pjson.version}`);
    logColor(`${pjson.description}`, `yellow`);
    logBR(1);
    await delay(500);

    resolve();
  });
};

module.exports.stepWrap = async function (label, callback) {
  this.startupStepLog(`!${label} START`);
  await callback.call(this);
  this.startupStepLog(`${label} COMPLETE!`);
}

module.exports.startupStepLog = function (label) {
  logColor(`${getStartUpIndent(startUpIndent)}${label.replace(/^!|!$/g, ``)}`, `white`, `cyan`);
  if (label.startsWith(`!`)) { startUpIndent++; }
  if (label.endsWith(`!`)) { logBR(1); startUpIndent--; }
};

module.exports.startupInfoLog = function (label) {
  logColor(`${getStartUpIndent(startUpIndent)}- ${label}`, `white`);
};

Object.freeze(module.exports);
