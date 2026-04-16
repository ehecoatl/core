// utils/log-format.js


'use strict';


const color = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
};

const format_bold = `\x1b[1m`; // exceptional
const format_clean = `\x1b[22m`;
const reset = `\x1b[0m`;
const fg = (c) => (c && c in color ? `\x1b[3${color[c]}m` : ``);
const bg = (c) => (c && c in color ? `\x1b[4${color[c]}m ` : ``);

const colorFormat = function (...args) {
  const fg_color = fg(args[1]);
  const bg_color = bg(args[2]);
  const c = `${fg_color}${bg_color}`;
  const msg = args[0]
    .replace(/(\n)/g, ` ${reset}$1${c}`)
    .replace(/^(\s*)(.*)(\s*)$/s, `$1${c}$2 ${reset}`);
  return msg;
};

module.exports.logBR = function (num, str = ` `) {
  console.log(str + `\n${str}`.repeat(num - 1));
};

module.exports.logColor = function (...args) {
  console.log(colorFormat(...args));
};

module.exports.errorColor = function (...args) {
  console.error(colorFormat(...args));
};

module.exports.boldFormat = function (msg) {
  return msg
    .replace(/(\n)/g, `${format_clean}$1${format_bold}`)
    .replace(/^(.*)$/s, `${format_bold}$1${format_clean}`);
};

module.exports.titleFormat = function (msg, options = {}) {
  const { textSync } = require("figlet");
  return textSync(msg, options);
};
