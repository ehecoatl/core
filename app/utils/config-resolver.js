// _core/boot/config-resolver.js


'use strict';


async function processConfigFolder(folder, output = {}) {
  const fs = require(`fs/promises`);
  const path = require(`path`);
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;

    const filePath = path.join(folder, entry.name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
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
