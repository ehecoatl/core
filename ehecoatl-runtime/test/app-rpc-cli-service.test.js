'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const {
  AppRpcCliService
} = require(`../_core/services/app-rpc-cli-service/app-rpc-cli-service`);

test(`app rpc cli service blocks commands by default`, async () => {
  const tempDir = createTempCliFixture();
  try {
    const service = createService({
      tempDir
    });

    const result = await service.runCommandRequest({
      commandLine: `ehecoatl tenant status`,
      internalMeta: {
        appRpcContext: {
          tenantId: `demo`,
          appId: `www`
        }
      }
    });

    assert.deepEqual(result, {
      ok: false,
      code: `forbidden_cli_command`,
      message: `Command is not allowed for this app.`
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`app rpc cli service allows exact and wildcard command patterns`, async () => {
  const tempDir = createTempCliFixture();
  const calls = [];
  try {
    const service = createService({
      tempDir,
      appRpcCli: {
        apps: {
          'aaaaaaaaaaaa/bbbbbb': [
            `ehecoatl tenant *`,
            `ehecoatl core status`
          ]
        }
      },
      execFileImpl(command, args, options, callback) {
        calls.push({ command, args, options });
        callback(null, `ok`, ``);
      }
    });

    const tenantResult = await service.runCommandRequest({
      commandLine: `ehecoatl tenant delete app my-app --yes`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });
    const coreResult = await service.runCommandRequest({
      commandLine: `ehecoatl core status`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });
    const blockedResult = await service.runCommandRequest({
      commandLine: `ehecoatl app status`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });

    assert.equal(tenantResult.ok, true);
    assert.equal(coreResult.ok, true);
    assert.deepEqual(blockedResult, {
      ok: false,
      code: `forbidden_cli_command`,
      message: `Command is not allowed for this app.`
    });
    assert.deepEqual(calls[0], {
      command: `bash`,
      args: [
        path.join(tempDir, `cli`, `ehecoatl.sh`),
        `tenant`,
        `delete`,
        `app`,
        `my-app`,
        `--yes`
      ],
      options: {
        cwd: path.join(tempDir, `tenants`, `tenant_example.test`),
        timeout: 10000,
        maxBuffer: 262144,
        encoding: `utf8`
      }
    });
    assert.equal(calls[1].options.cwd, `/opt/ehecoatl`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`app rpc cli service rejects invalid or unsupported command lines`, async () => {
  const tempDir = createTempCliFixture();
  try {
    const service = createService({
      tempDir,
      appRpcCli: {
        apps: {
          'aaaaaaaaaaaa/bbbbbb': [`ehecoatl *`]
        }
      }
    });

    const invalidPrefix = await service.runCommandRequest({
      commandLine: `ls -la`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });
    const invalidOperator = await service.runCommandRequest({
      commandLine: `ehecoatl && whoami`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });
    const missingCommand = await service.runCommandRequest({
      commandLine: `ehecoatl tenant missing`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });

    assert.equal(invalidPrefix.code, `invalid_cli_command`);
    assert.equal(invalidOperator.code, `invalid_cli_command`);
    assert.equal(missingCommand.code, `invalid_cli_command`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`app rpc cli service returns stdout stderr and exit code for executed commands`, async () => {
  const tempDir = createTempCliFixture();
  try {
    const service = createService({
      tempDir,
      appRpcCli: {
        apps: {
          'aaaaaaaaaaaa/bbbbbb': [`ehecoatl app status`]
        }
      },
      execFileImpl(_command, _args, _options, callback) {
        const error = new Error(`command failed`);
        error.code = 2;
        error.stdout = `partial out`;
        error.stderr = `bad things`;
        callback(error);
      }
    });

    const result = await service.runCommandRequest({
      commandLine: `ehecoatl app status`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, `partial out`);
    assert.equal(result.stderr, `bad things`);
    assert.equal(result.commandLine, `ehecoatl app status`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(`app rpc cli service preserves explicit app selectors while matching normalized command patterns`, async () => {
  const tempDir = createTempCliFixture();
  const calls = [];
  try {
    const service = createService({
      tempDir,
      appRpcCli: {
        apps: {
          'aaaaaaaaaaaa/bbbbbb': [`ehecoatl app status`]
        }
      },
      execFileImpl(command, args, options, callback) {
        calls.push({ command, args, options });
        callback(null, `ok`, ``);
      }
    });

    const result = await service.runCommandRequest({
      commandLine: `ehecoatl app portal@example.test status`,
      internalMeta: {
        appRpcContext: {
          tenantId: `aaaaaaaaaaaa`,
          appId: `bbbbbb`
        }
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls[0].args, [
      path.join(tempDir, `cli`, `ehecoatl.sh`),
      `app`,
      `portal@example.test`,
      `status`
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createService({
  tempDir,
  appRpcCli = {},
  execFileImpl = (_command, _args, _options, callback) => callback(null, `ok`, ``)
} = {}) {
  return new AppRpcCliService({
    config: {
      appRpcCli: {
        tenantsBase: path.join(tempDir, `tenants`),
        defaultTimeoutMs: 10000,
        maxTimeoutMs: 30000,
        maxBufferBytes: 262144,
        apps: {},
        ...appRpcCli
      }
    }
  }, {
    execFileImpl,
    cliEntrypoint: path.join(tempDir, `cli`, `ehecoatl.sh`),
    commandsDir: path.join(tempDir, `cli`, `commands`)
  });
}

function createTempCliFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-app-rpc-cli-`));
  const commandsRoot = path.join(tempDir, `cli`, `commands`);
  const tenantsBase = path.join(tempDir, `tenants`);
  const tenantRoot = path.join(tenantsBase, `tenant_example.test`);
  const appRoot = path.join(tenantRoot, `app_portal`);
  fs.mkdirSync(path.join(commandsRoot, `tenant`), { recursive: true });
  fs.mkdirSync(path.join(commandsRoot, `core`), { recursive: true });
  fs.mkdirSync(path.join(commandsRoot, `app`), { recursive: true });
  fs.mkdirSync(path.join(commandsRoot, `firewall`), { recursive: true });
  fs.mkdirSync(path.join(appRoot, `config`), { recursive: true });
  fs.writeFileSync(path.join(tempDir, `cli`, `ehecoatl.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(commandsRoot, `tenant`, `status.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(commandsRoot, `tenant`, `delete_app.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(commandsRoot, `core`, `status.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(commandsRoot, `app`, `status.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(commandsRoot, `firewall`, `newtork_wan_block.sh`), `#!/bin/bash\n`);
  fs.writeFileSync(path.join(tenantRoot, `config.json`), JSON.stringify({
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.test`
  }, null, 2) + `\n`);
  fs.writeFileSync(path.join(appRoot, `config`, `app.json`), JSON.stringify({
    appId: `bbbbbb`,
    appName: `portal`
  }, null, 2) + `\n`);
  return tempDir;
}
