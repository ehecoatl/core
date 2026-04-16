// utils/logger/hourly-file-logger.js


'use strict';

const fs = require(`fs`);
const path = require(`path`);

const defaultOptions = Object.freeze({
  enabled: false,
  baseDir: `/var/opt/ehecatl/logs/hourly`,
  maxFiles: 168,
  cleanupIntervalMs: 300000
});

/**
 * Creates a lightweight hourly file logger with bounded file-retention cleanup.
 * @param {{
 * enabled?: boolean,
 * baseDir?: string,
 * maxFiles?: number,
 * cleanupIntervalMs?: number
 * }} options
 */
function createHourlyFileLogger(options = {}) {
  const config = {
    ...defaultOptions,
    ...(options ?? {})
  };

  const cleanupIntervalMs = Number(config.cleanupIntervalMs);
  const cleanupTimers = new Map();
  const cleanupRunning = new Map();

  function writeRuntime(message) {
    write(`runtime`, message);
  }

  function writeError(message) {
    write(`error`, message);
  }

  function close() {
    for (const timer of cleanupTimers.values()) {
      clearInterval(timer);
    }
    cleanupTimers.clear();
  }

  function write(channel, message) {
    if (!config.enabled) return;
    if (typeof message !== `string` || message.length === 0) return;

    const now = new Date();
    const dateLabel = toDateLabel(now);
    const hourLabel = toHourLabel(now);
    const channelDir = path.join(config.baseDir, channel, dateLabel);
    const targetFile = path.join(channelDir, `${hourLabel}.log`);

    try {
      fs.mkdirSync(channelDir, { recursive: true });
      fs.appendFileSync(targetFile, `${message}\n`, `utf8`);
      scheduleCleanup(channel);
    } catch {
      // Keep runtime resilient: file-logging failures must never crash process hooks.
    }
  }

  function scheduleCleanup(channel) {
    if (!Number.isFinite(cleanupIntervalMs) || cleanupIntervalMs <= 0) return;
    if (cleanupTimers.has(channel)) return;

    const timer = setInterval(() => {
      cleanupChannel(channel).catch(() => { });
    }, cleanupIntervalMs);
    timer.unref?.();
    cleanupTimers.set(channel, timer);

    cleanupChannel(channel).catch(() => { });
  }

  async function cleanupChannel(channel) {
    if (!config.enabled) return;
    if (cleanupRunning.get(channel) === true) return;
    cleanupRunning.set(channel, true);

    try {
      const maxFiles = Number(config.maxFiles);
      if (!Number.isInteger(maxFiles) || maxFiles <= 0) return;

      const channelRoot = path.join(config.baseDir, channel);
      if (!fs.existsSync(channelRoot)) return;

      const files = listLogFiles(channelRoot);
      if (files.length <= maxFiles) return;

      files.sort((left, right) => right.mtimeMs - left.mtimeMs);
      const removeList = files.slice(maxFiles);
      for (const fileInfo of removeList) {
        fs.rmSync(fileInfo.path, { force: true });
      }

      pruneEmptyDirectories(channelRoot);
    } finally {
      cleanupRunning.set(channel, false);
    }
  }

  return Object.freeze({
    writeRuntime,
    writeError,
    close
  });
}

function listLogFiles(rootPath) {
  const files = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(`.log`)) continue;

      try {
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          mtimeMs: Number(stat?.mtimeMs ?? 0)
        });
      } catch {
        continue;
      }
    }
  }

  return files;
}

function pruneEmptyDirectories(rootPath) {
  const stack = [rootPath];
  const ordered = [];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    ordered.push(currentPath);
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(currentPath, entry.name));
      }
    }
  }

  ordered.sort((left, right) => right.length - left.length);
  for (const dirPath of ordered) {
    if (dirPath === rootPath) continue;
    try {
      const entries = fs.readdirSync(dirPath);
      if (entries.length === 0) {
        fs.rmdirSync(dirPath);
      }
    } catch {
      continue;
    }
  }
}

function toDateLabel(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, `0`);
  const day = String(date.getUTCDate()).padStart(2, `0`);
  return `${year}-${month}-${day}`;
}

function toHourLabel(date) {
  return String(date.getUTCHours()).padStart(2, `0`);
}

module.exports = Object.freeze({
  createHourlyFileLogger
});
