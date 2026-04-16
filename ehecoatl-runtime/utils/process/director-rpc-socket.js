'use strict';

const path = require(`node:path`);

const {
  getSupervisionScopePath,
  getInternalScopePath
} = require(`../../contracts/utils`);

function getDirectorRpcSocketDir({ env = process.env } = {}) {
  const overridePath = env?.DIRECTOR_RPC_SOCKET_DIR;
  if (typeof overridePath === `string` && overridePath.trim().length > 0) {
    return overridePath.trim();
  }

  return (
    getSupervisionScopePath(`RUNTIME`, `rpc`)
    ?? path.join(getInternalScopePath(`RUNTIME`, `lib`) ?? `/var/lib/ehecoatl`, `rpc`)
  );
}

function getDirectorRpcSocketPath({ env = process.env } = {}) {
  const overridePath = env?.DIRECTOR_RPC_SOCKET_PATH;
  if (typeof overridePath === `string` && overridePath.trim().length > 0) {
    return overridePath.trim();
  }

  return path.join(getDirectorRpcSocketDir({ env }), `director.sock`);
}

module.exports = {
  getDirectorRpcSocketDir,
  getDirectorRpcSocketPath
};

Object.freeze(module.exports);
