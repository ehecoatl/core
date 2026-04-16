// config/config-resolver.js


'use strict';


async function processConfigFolder(folder, output = {}) {
  const fs = require(`fs/promises`);
  const path = require(`path`);
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch((err) => {
    if (err?.code === `ENOENT`) return [];
    throw err;
  });

  const orderedEntries = [...entries].sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const entry of orderedEntries) {
    const entryPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      const groupName = entry.name;
      if (!(groupName in output)) {
        console.warn(`Unknown config section ${groupName} in directory ${entry.name}, skipping.`);
        continue;
      }

      const groupEntries = (await fs.readdir(entryPath, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const groupEntry of groupEntries) {
        if (!groupEntry.isFile()) continue;
        if (!groupEntry.name.toLowerCase().endsWith(`.json`)) continue;

        const filePath = path.join(entryPath, groupEntry.name);
        try {
          const raw = await fs.readFile(filePath, `utf8`);
          const parsed = JSON.parse(raw);
          const baseName = path.basename(groupEntry.name, path.extname(groupEntry.name));
          if (!output[groupName] || typeof output[groupName] !== `object` || Array.isArray(output[groupName])) {
            output[groupName] = {};
          }
          output[groupName][baseName] = parsed;
        } catch (err) {
          err.message = `Failed to load config file : ${filePath}`;
          throw err;
        }
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(`.json`)) continue;

    const filePath = entryPath;
    try {
      const raw = await fs.readFile(filePath, `utf8`);
      const parsed = JSON.parse(raw);
      const baseName = path.basename(entry.name, path.extname(entry.name));
      if (baseName in output) { output[baseName] = parsed; }
      else { console.warn(`Unknown config section ${baseName} in file ${entry.name}, skipping.`); }
    } catch (err) {
      // Fail fast: surface configuration issues immediately
      err.message = `Failed to load config file : ${filePath}`;
      throw err;
    }
  }
  return output;
}

module.exports = processConfigFolder;
Object.freeze(module.exports);
