'use strict';

const path = require(`node:path`);

function resolveScopeFallbackPathSync({
  primaryRootFolder = null,
  fallbackRootFolder = null,
  segments = [],
  filename = ``,
  existsSync = null
} = {}) {
  const normalizedSegments = normalizeSegments(segments);
  const normalizedFilename = normalizePathPart(filename);
  const primaryPath = buildTargetPath(primaryRootFolder, normalizedSegments, normalizedFilename);
  const fallbackPath = fallbackRootFolder
    ? buildTargetPath(fallbackRootFolder, normalizedSegments, normalizedFilename)
    : null;

  let scope = `app`;
  let resolvedPath = primaryPath;

  if (primaryPath && typeof existsSync === `function` && existsSync(primaryPath)) {
    scope = `app`;
    resolvedPath = primaryPath;
  } else if (fallbackPath && typeof existsSync === `function` && existsSync(fallbackPath)) {
    scope = `shared`;
    resolvedPath = fallbackPath;
  }

  return Object.freeze({
    scope,
    path: resolvedPath,
    primaryPath,
    fallbackPath
  });
}

function buildTargetPath(rootFolder, segments = [], filename = ``) {
  const normalizedRootFolder = normalizeFolderPath(rootFolder);
  const pathParts = [
    normalizedRootFolder,
    ...normalizeSegments(segments),
    ...(
      normalizePathPart(filename)
        ? [normalizePathPart(filename)]
        : []
    )
  ].filter(Boolean);

  return pathParts.length > 0
    ? path.join(...pathParts)
    : ``;
}

function normalizeFolderPath(folderPath) {
  return typeof folderPath === `string`
    ? folderPath.trim()
    : ``;
}

function normalizePathPart(value) {
  return typeof value === `string`
    ? value.trim()
    : ``;
}

function normalizeSegments(segments) {
  return Array.isArray(segments)
    ? segments.map(normalizePathPart).filter(Boolean)
    : [];
}

module.exports = Object.freeze({
  resolveScopeFallbackPathSync,
  buildTargetPath,
  normalizeFolderPath,
  normalizePathPart,
  normalizeSegments
});
