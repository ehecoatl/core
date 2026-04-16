'use strict';

const path = require(`node:path`);
const { spawn } = require(`node:child_process`);
const fs = require(`node:fs`);

const {
  PRIVILEGED_HOST_BRIDGE_REQUEST,
  PRIVILEGED_HOST_BRIDGE_RESPONSE
} = require(`./privileged-host-bridge`);

const FIREWALL_COMMANDS_DIR = path.join(__dirname, `..`, `cli`, `commands`, `firewall`);
const FIREWALL_COMMAND_TIMEOUT_MS = 3000;
const HOST_COMMAND_TIMEOUT_MS = 5000;

function runFirewallCommand(commandFile, args = [], {
  timeoutMs = FIREWALL_COMMAND_TIMEOUT_MS
} = {}) {
  const commandPath = path.join(FIREWALL_COMMANDS_DIR, commandFile);

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(commandPath, args, {
      cwd: path.join(__dirname, `..`),
      env: { ...process.env },
      stdio: [`ignore`, `inherit`, `inherit`],
      shell: false
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(`SIGKILL`); } catch { }
      reject(new Error(`Firewall command ${commandFile} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.once(`error`, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once(`exit`, (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `Firewall command ${commandFile} failed (code=${code ?? `null`} signal=${signal ?? `null`})`
      ));
    });
  });
}

async function clearStaleFirewallStateBeforeBoot() {
  const cleanupCommands = [
    [`newtork_local_proxy.sh`, [`off`, `all`]],
    [`newtork_wan_block.sh`, [`off`, `all`]]
  ];

  await Promise.allSettled(cleanupCommands.map(([commandFile, args]) => (
    runFirewallCommand(commandFile, args).catch((error) => {
      console.error(`[BOOTSTRAP FIREWALL CLEANUP ERROR]`);
      console.error(error);
    })
  )));
}

function runHostCommand(command, args = [], {
  timeoutMs = HOST_COMMAND_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = ``;
    let stderr = ``;
    const child = spawn(command, args, {
      cwd: path.join(__dirname, `..`),
      env: { ...process.env },
      stdio: [`ignore`, `pipe`, `pipe`],
      shell: false
    });

    child.stdout?.on(`data`, (chunk) => {
      if (stdout.length < 8192) stdout += String(chunk);
    });
    child.stderr?.on(`data`, (chunk) => {
      if (stderr.length < 8192) stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(`SIGKILL`); } catch { }
      const error = new Error(`Host command ${command} timed out after ${timeoutMs}ms`);
      error.code = `HOST_COMMAND_TIMEOUT`;
      reject(error);
    }, timeoutMs);
    timer.unref?.();

    child.once(`error`, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once(`exit`, (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
        return;
      }

      const error = new Error(`Host command ${command} failed (code=${code ?? `null`} signal=${signal ?? `null`})`);
      error.code = `HOST_COMMAND_FAILED`;
      error.details = {
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
      reject(error);
    });
  });
}

function runDetachedHostCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.join(__dirname, `..`),
      env: { ...process.env },
      stdio: [`ignore`, `ignore`, `ignore`],
      shell: false,
      detached: true
    });

    child.once(`error`, reject);
    child.once(`spawn`, () => {
      child.unref();
      resolve({
        pid: child.pid ?? null
      });
    });
  });
}

function normalizeCommandEntries(commandEntries, {
  placeholderDomain = ``
} = {}) {
  if (!Array.isArray(commandEntries) || commandEntries.length === 0) {
    throw new Error(`Privileged host operation requires a non-empty command array`);
  }

  return commandEntries.map((entry) => String(entry ?? ``).replaceAll(`{domain}`, placeholderDomain));
}

function assertManagedNginxPath(targetPath) {
  const normalizedPath = path.resolve(targetPath);
  const managedRoot = path.resolve(`/etc/nginx/conf.d/ehecoatl`);
  if (
    normalizedPath !== managedRoot &&
    !normalizedPath.startsWith(`${managedRoot}${path.sep}`)
  ) {
    const error = new Error(`Managed nginx path is outside the allowed root: ${targetPath}`);
    error.code = `INVALID_MANAGED_NGINX_PATH`;
    throw error;
  }
  return normalizedPath;
}

async function resolveUid(userName) {
  const resolved = await runHostCommand(`id`, [`-u`, String(userName)]);
  const uid = Number.parseInt(String(resolved.stdout ?? ``).trim(), 10);
  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error(`Could not resolve uid for user "${userName}"`);
  }
  return uid;
}

async function resolveGid(groupName) {
  const resolved = await runHostCommand(`getent`, [`group`, String(groupName)]);
  const parts = String(resolved.stdout ?? ``).trim().split(`:`);
  const gid = Number.parseInt(parts[2] ?? ``, 10);
  if (!Number.isInteger(gid) || gid < 0) {
    throw new Error(`Could not resolve gid for group "${groupName}"`);
  }
  return gid;
}

async function handlePrivilegedBridgeOperation(operation, payload = {}) {
  switch (operation) {
    case `nginx.ensureManagedConfigDir`: {
      const targetDir = assertManagedNginxPath(String(payload.targetDir ?? ``));
      const owner = String(payload.owner ?? `ehecoatl`).trim() || `ehecoatl`;
      const group = String(payload.group ?? `g_directorScope`).trim() || `g_directorScope`;
      const mode = String(payload.mode ?? `2770`).trim() || `2770`;
      const desiredUid = await resolveUid(owner);
      const desiredGid = await resolveGid(group);
      const desiredMode = Number.parseInt(mode, 8);
      await fs.promises.mkdir(targetDir, { recursive: true });
      const currentStats = await fs.promises.stat(targetDir);
      if (currentStats.uid !== desiredUid || currentStats.gid !== desiredGid) {
        await fs.promises.chown(targetDir, desiredUid, desiredGid);
      }
      if ((currentStats.mode & 0o7777) !== desiredMode) {
        await fs.promises.chmod(targetDir, desiredMode);
      }
      return { targetDir };
    }
    case `nginx.writeManagedSource`: {
      const targetPath = assertManagedNginxPath(String(payload.targetPath ?? ``));
      const content = String(payload.content ?? ``);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, `utf8`);
      return { targetPath };
    }
    case `nginx.removeManagedSource`: {
      const targetPath = assertManagedNginxPath(String(payload.targetPath ?? ``));
      await fs.promises.rm(targetPath, { force: true });
      return { targetPath };
    }
    case `firewall.localProxy.on`:
      return await runFirewallCommand(`newtork_local_proxy.sh`, [
        `on`,
        String(payload.processUser ?? ``),
        String(payload.openLocalPortsCsv ?? ``),
        String(payload.proxyPortsCsv ?? ``)
      ].filter((value, index) => index < 3 || value !== ``));
    case `firewall.localProxy.off`:
      return await runFirewallCommand(`newtork_local_proxy.sh`, [`off`, String(payload.processUser ?? ``)]);
    case `firewall.localProxy.offAll`:
      return await runFirewallCommand(`newtork_local_proxy.sh`, [`off`, `all`]);
    case `firewall.wanBlock.on`:
      return await runFirewallCommand(`newtork_wan_block.sh`, [
        `on`,
        String(payload.processUser ?? ``),
        String(payload.label ?? `unknown`)
      ]);
    case `firewall.wanBlock.off`:
      return await runFirewallCommand(`newtork_wan_block.sh`, [
        `off`,
        String(payload.processUser ?? ``),
        String(payload.label ?? `unknown`)
      ]);
    case `firewall.wanBlock.offAll`:
      return await runFirewallCommand(`newtork_wan_block.sh`, [`off`, `all`]);
    case `nginx.validate`: {
      const [binary, ...args] = Array.isArray(payload.testCommand) && payload.testCommand.length > 0
        ? payload.testCommand.map((entry) => String(entry))
        : [`nginx`, `-t`];
      return await runHostCommand(binary, args);
    }
    case `nginx.reload`: {
      const [reloadBinary, ...reloadArgs] = Array.isArray(payload.reloadCommand) && payload.reloadCommand.length > 0
        ? payload.reloadCommand.map((entry) => String(entry))
        : [`systemctl`, `reload`, `nginx`];
      const reloaded = await runHostCommand(reloadBinary, reloadArgs);
      return {
        tested: null,
        reloaded
      };
    }
    case `certificate.issueLetsEncrypt`: {
      const domain = String(payload.domain ?? ``).trim().toLowerCase();
      if (!domain) {
        throw new Error(`certificate.issueLetsEncrypt requires a domain`);
      }

      const issueCommand = normalizeCommandEntries(payload.issueCommandTemplate ?? [], {
        placeholderDomain: domain
      });
      const [issueBinary, ...issueArgs] = issueCommand;
      const started = await runDetachedHostCommand(issueBinary, issueArgs);

      return {
        domain,
        started: true,
        pid: started.pid ?? null
      };
    }
    default: {
      const error = new Error(`Unsupported privileged host operation "${operation}"`);
      error.code = `UNSUPPORTED_PRIVILEGED_HOST_OPERATION`;
      throw error;
    }
  }
}

function attachPrivilegedBridge(mainChild) {
  mainChild.on(`message`, async (message) => {
    if (!message || message.type !== PRIVILEGED_HOST_BRIDGE_REQUEST) return;
    try {
      console.log(`[PRIVILEGED HOST] root handling operation=${message.operation}`);
      const result = await handlePrivilegedBridgeOperation(message.operation, message.payload ?? {});
      console.log(`[PRIVILEGED HOST] root completed operation=${message.operation}`);
      mainChild.send({
        type: PRIVILEGED_HOST_BRIDGE_RESPONSE,
        requestId: message.requestId,
        success: true,
        result
      });
    } catch (error) {
      console.error(`[PRIVILEGED HOST] root failed operation=${message.operation}`);
      console.error(error);
      mainChild.send({
        type: PRIVILEGED_HOST_BRIDGE_RESPONSE,
        requestId: message.requestId,
        success: false,
        error: {
          code: error?.code ?? null,
          message: error?.message ?? String(error),
          details: error?.details ?? null
        }
      });
    }
  });
}

module.exports = {
  attachPrivilegedBridge,
  clearStaleFirewallStateBeforeBoot,
  handlePrivilegedBridgeOperation
};

Object.freeze(module.exports);
