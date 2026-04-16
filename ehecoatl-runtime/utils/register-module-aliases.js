'use strict';

try {
  require(`module-alias/register`);
} catch {
  const Module = require(`node:module`);
  const path = require(`node:path`);
  const packageJson = require(`../package.json`);

  const aliasEntries = Object.entries(packageJson._moduleAliases ?? {}).map(([key, target]) => ([
    key,
    path.resolve(__dirname, `..`, target)
  ]));
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    for (const [aliasKey, aliasTarget] of aliasEntries) {
      if (request === aliasKey || request.startsWith(aliasKey + `/`)) {
        const suffix = request.slice(aliasKey.length);
        const resolvedRequest = path.join(aliasTarget, suffix);
        return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
      }
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}
