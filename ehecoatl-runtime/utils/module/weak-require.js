'use strict';

const fs = require(`node:fs`);
const path = require(`node:path`);

const trackedModules = new Map();

function weakRequire(filePath) {
  const normalizedPath = normalizeFilePath(filePath);
  const currentMtimeMs = readMtimeMs(normalizedPath);
  const trackedEntry = trackedModules.get(normalizedPath) ?? null;
  const shouldReload = currentMtimeMs == null
    || !trackedEntry
    || trackedEntry.mtimeMs !== currentMtimeMs;

  if (!shouldReload) {
    return trackedEntry.module;
  }

  clearTrackedModule(normalizedPath);
  try {
    const loadedModule = require(normalizedPath);
    trackedModules.set(normalizedPath, {
      module: loadedModule,
      mtimeMs: currentMtimeMs ?? readMtimeMs(normalizedPath)
    });
    return loadedModule;
  } catch (error) {
    clearTrackedModule(normalizedPath);
    throw error;
  }
}

weakRequire.clear = function clear(filePath) {
  clearTrackedModule(normalizeFilePath(filePath));
};

weakRequire.clearAll = function clearAll() {
  for (const filePath of trackedModules.keys()) {
    clearTrackedModule(filePath);
  }
};

function clearTrackedModule(filePath) {
  trackedModules.delete(filePath);
  delete require.cache[filePath];

  try {
    delete require.cache[require.resolve(filePath)];
  } catch {}
}

function normalizeFilePath(filePath) {
  if (typeof filePath !== `string` || !filePath.trim()) {
    throw new Error(`weakRequire requires a non-empty absolute file path`);
  }

  const normalizedPath = path.resolve(filePath);
  if (!path.isAbsolute(normalizedPath)) {
    throw new Error(`weakRequire requires an absolute file path`);
  }
  return normalizedPath;
}

function readMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (error) {
    if (error?.code === `ENOENT`) return null;
    throw error;
  }
}

module.exports = weakRequire;
Object.freeze(module.exports);
