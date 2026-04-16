'use strict';

const contracts = require(`./index.js`);

function getServiceRuntimeLayer() {
  return Object.values(contracts.LAYERS ?? {});
}

function getPathEntries() {
  const entries = [];
  for (const layer of getServiceRuntimeLayer()) {
    const defaults = layer?.PATH_DEFAULTS ?? {};
    const pathGroups = layer?.PATHS ?? {};

    for (const section of Object.values(pathGroups)) {
      if (!section || typeof section !== `object`) continue;

      for (const tuple of Object.values(section)) {
        if (!Array.isArray(tuple) || typeof tuple[0] !== `string`) continue;

        entries.push({
          path: tuple[0],
          owner: tuple[1] ?? defaults.owner ?? `root`,
          group: tuple[2] ?? defaults.group ?? `root`,
          mode: tuple[3] ?? defaults.mode ?? `0755`,
          recursive: tuple[4] ?? defaults.recursive ?? true,
          type: tuple[5] ?? defaults.type ?? `directory`
        });
      }
    }
  }

  return entries;
}

function isConcreteSystemPath(pathname) {
  return (
    typeof pathname === `string` &&
    pathname.length > 0 &&
    !pathname.includes(`{`) &&
    (
      pathname.startsWith(`/opt/`) ||
      pathname.startsWith(`/var/`) ||
      pathname.startsWith(`/etc/`) ||
      pathname.startsWith(`/srv/`)
    )
  );
}

function deriveSetupTopology() {
  const seen = new Set();
  const derived = [];

  for (const entry of getPathEntries()) {
    if (!isConcreteSystemPath(entry.path)) continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    derived.push(entry);
  }

  derived.sort((left, right) => left.path.localeCompare(right.path));
  return derived;
}

function printTsv() {
  for (const entry of deriveSetupTopology()) {
    process.stdout.write(
      `${entry.path}\t${entry.owner}\t${entry.group}\t${entry.mode}\t${entry.recursive ? `1` : `0`}\n`
      .replace(/\n$/, `\t${entry.type}\n`)
    );
  }
}

if (require.main === module) {
  const [mode] = process.argv.slice(2);

  switch (mode) {
    case undefined:
    case `json`:
      process.stdout.write(JSON.stringify(deriveSetupTopology(), null, 2) + `\n`);
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
  deriveSetupTopology
};

Object.freeze(module.exports);
