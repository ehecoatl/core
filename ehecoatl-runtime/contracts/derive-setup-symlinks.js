'use strict';

const contracts = require(`./index.js`);

function getInternalScopeSymlinks() {
  const symlinkEntries = contracts.LAYERS?.internalScope?.SYMLINKS ?? {};
  const derived = [];

  for (const tuple of Object.values(symlinkEntries)) {
    if (!Array.isArray(tuple) || typeof tuple[0] !== `string` || typeof tuple[1] !== `string`) continue;
    if (tuple[0].includes(`{`) || tuple[1].includes(`{`)) continue;

    derived.push({
      linkPath: tuple[0],
      targetPath: tuple[1]
    });
  }

  derived.sort((left, right) => left.linkPath.localeCompare(right.linkPath));
  return derived;
}

function printTsv() {
  for (const entry of getInternalScopeSymlinks()) {
    process.stdout.write(`${entry.linkPath}\t${entry.targetPath}\n`);
  }
}

if (require.main === module) {
  const [mode] = process.argv.slice(2);

  switch (mode) {
    case undefined:
    case `json`:
      process.stdout.write(JSON.stringify(getInternalScopeSymlinks(), null, 2) + `\n`);
      break;
    case `tsv`:
      printTsv();
      break;
    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }
}

module.exports = {
  getInternalScopeSymlinks
};

Object.freeze(module.exports);
