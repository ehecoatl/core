'use strict';

const fs = require(`node:fs/promises`);
const net = require(`node:net`);
const path = require(`node:path`);

const { getDirectorRpcSocketPath } = require(`@/utils/process/director-rpc-socket`);

async function startDirectorCliSocketServer({
  rpcEndpoint,
  config,
  socketPath = getDirectorRpcSocketPath()
}) {
  const socketDir = path.dirname(socketPath);
  await fs.mkdir(socketDir, { recursive: true, mode: 0o770 });
  await fs.chmod(socketDir, 0o770).catch(() => { });
  await fs.unlink(socketPath).catch((error) => {
    if (error?.code !== `ENOENT`) throw error;
  });

  const localAskTimeoutMs = Number(config?.adapters?.rpcRuntime?.localAskTimeoutMs ?? 120_000);
  const server = net.createServer((socket) => {
    socket.setEncoding(`utf8`);
    let buffer = ``;
    let responded = false;

    const respond = (payload) => {
      if (responded) return;
      responded = true;
      socket.end(JSON.stringify(payload) + `\n`);
    };

    socket.on(`data`, async (chunk) => {
      if (responded) return;
      buffer += chunk;
      if (!buffer.includes(`\n`)) return;

      try {
        const [rawRequest] = buffer.split(`\n`);
        const request = JSON.parse(String(rawRequest ?? ``).trim() || `{}`);
        if (!request?.question) {
          respond({
            success: false,
            error: `director CLI request is missing "question"`
          });
          return;
        }

        const data = await rpcEndpoint.askLocal({
          question: request.question,
          data: request.data ?? {},
          internalMeta: {
            transport: `director_cli_socket`
          },
          timeoutMs: localAskTimeoutMs,
          origin: `cli`
        });

        respond({
          success: true,
          data
        });
      } catch (error) {
        respond({
          success: false,
          error: error?.message ?? String(error)
        });
      }
    });

    socket.on(`error`, (error) => {
      respond({
        success: false,
        error: error?.message ?? String(error)
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once(`error`, reject);
    server.listen(socketPath, () => {
      server.off(`error`, reject);
      resolve();
    });
  });

  await fs.chmod(socketPath, 0o660).catch(() => { });

  return {
    socketPath,
    server,
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
      }).catch(() => { });
      await fs.unlink(socketPath).catch((error) => {
        if (error?.code !== `ENOENT`) throw error;
      });
    }
  };
}

module.exports = {
  startDirectorCliSocketServer
};

Object.freeze(module.exports);
