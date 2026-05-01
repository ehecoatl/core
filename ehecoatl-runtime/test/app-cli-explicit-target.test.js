'use strict';

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { execFile } = require(`node:child_process`);
const { promisify } = require(`node:util`);

const execFileAsync = promisify(execFile);

const cliEntrypoint = path.join(__dirname, `..`, `cli`, `ehecoatl.sh`);
const cliCommonPath = path.join(__dirname, `..`, `cli`, `lib`, `cli-common.sh`);

test(`explicit app target resolves by domain outside app cwd`, async () => {
  const fixture = createTenantFixture();
  try {
    const targetJson = await resolveExplicitAppTarget(fixture, {
      explicitTarget: `portal@example.test`,
      groups: [`g_aaaaaaaaaaaa_bbbbbb`],
      cwd: fixture.baseDir
    });

    assert.equal(targetJson.tenantDomain, `example.test`);
    assert.equal(targetJson.appName, `portal`);
    assert.equal(targetJson.appId, `bbbbbb`);
    assert.equal(targetJson.appRoot, fixture.portalRoot);
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target resolves by tenant id`, async () => {
  const fixture = createTenantFixture();
  try {
    const targetJson = await resolveExplicitAppTarget(fixture, {
      explicitTarget: `portal@aaaaaaaaaaaa`,
      groups: [`g_aaaaaaaaaaaa_bbbbbb`],
      cwd: fixture.baseDir
    });

    assert.equal(targetJson.tenantId, `aaaaaaaaaaaa`);
    assert.equal(targetJson.appName, `portal`);
    assert.equal(targetJson.appId, `bbbbbb`);
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target takes precedence over cwd`, async () => {
  const fixture = createTenantFixture();
  try {
    const targetJson = await resolveExplicitAppTarget(fixture, {
      explicitTarget: `portal@example.test`,
      groups: [`g_aaaaaaaaaaaa_bbbbbb`],
      cwd: fixture.adminRoot
    });

    assert.equal(targetJson.appName, `portal`);
    assert.equal(targetJson.appRoot, fixture.portalRoot);
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target returns app config path for config workflows`, async () => {
  const fixture = createTenantFixture();
  try {
    const { stdout } = await runCliCommonShell(fixture, {
      explicitTarget: `portal@example.test`,
      groups: [`g_aaaaaaaaaaaa_bbbbbb`],
      cwd: fixture.baseDir,
      scriptBody: `
        TARGET_JSON="$(resolve_app_scope_target_json)"
        target_config_path "$TARGET_JSON"
      `
    });

    assert.equal(stdout.trim(), path.join(fixture.portalRoot, `config`, `app.json`));
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target rejects invalid selector shapes`, async () => {
  const fixture = createTenantFixture();
  try {
    await assert.rejects(
      resolveExplicitAppTarget(fixture, {
        explicitTarget: `portal@`,
        groups: [`g_aaaaaaaaaaaa_bbbbbb`],
        cwd: fixture.baseDir
      }),
      /Explicit app target must use the shape <app_name>@<domain> or <app_name>@<tenant_id>\./
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target rejects missing apps`, async () => {
  const fixture = createTenantFixture();
  try {
    await assert.rejects(
      resolveExplicitAppTarget(fixture, {
        explicitTarget: `missing@example.test`,
        groups: [`g_aaaaaaaaaaaa_bbbbbb`],
        cwd: fixture.baseDir
      }),
      /No app could be found for explicit target: missing@example\.test/
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test(`explicit app target enforces app group membership`, async () => {
  const fixture = createTenantFixture();
  try {
    await assert.rejects(
      resolveExplicitAppTarget(fixture, {
        explicitTarget: `portal@example.test`,
        groups: [`g_aaaaaaaaaaaa_cccccc`],
        cwd: fixture.baseDir
      }),
      /requires membership in g_aaaaaaaaaaaa_bbbbbb/
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test(`dispatcher app help accepts explicit selector`, async () => {
  const fixture = createTenantFixture();
  try {
    const { stdout } = await execFileAsync(`bash`, [
      cliEntrypoint,
      `app`,
      `portal@example.test`,
      `--help`
    ], {
      cwd: fixture.baseDir,
      env: {
        ...process.env,
        EHECOATL_CLI_USERNAME: `tester`,
        EHECOATL_CLI_GROUPS: `g_aaaaaaaaaaaa_bbbbbb`
      }
    });

    assert.match(stdout, /App target override: app:portal \(domain:example\.test\)/);
    assert.match(stdout, /Available 'app' commands:/);
  } finally {
    cleanupFixture(fixture);
  }
});

test(`app status help accepts explicit selector`, async () => {
  const commandPath = path.join(__dirname, `..`, `cli`, `commands`, `app`, `status.sh`);
  const { stdout } = await execFileAsync(`bash`, [commandPath, `--help`]);
  assert.match(stdout, /Usage: ehecoatl app \[<app_name>@<domain>\|<app_name>@<tenant_id>] status/);
});

function createTenantFixture() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-app-cli-`));
  const tenantsBase = path.join(baseDir, `tenants`);
  const tenantRoot = path.join(tenantsBase, `tenant_example.test`);
  const portalRoot = path.join(tenantRoot, `app_portal`);
  const adminRoot = path.join(tenantRoot, `app_admin`);

  fs.mkdirSync(path.join(portalRoot, `config`), { recursive: true });
  fs.mkdirSync(path.join(adminRoot, `config`), { recursive: true });
  fs.writeFileSync(path.join(tenantRoot, `config.json`), JSON.stringify({
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.test`
  }, null, 2) + `\n`);
  fs.writeFileSync(path.join(portalRoot, `config`, `app.json`), JSON.stringify({
    appId: `bbbbbb`,
    appName: `portal`,
    appEnabled: true
  }, null, 2) + `\n`);
  fs.writeFileSync(path.join(adminRoot, `config`, `app.json`), JSON.stringify({
    appId: `cccccc`,
    appName: `admin`,
    appEnabled: true
  }, null, 2) + `\n`);

  return {
    baseDir,
    tenantsBase,
    tenantRoot,
    portalRoot,
    adminRoot
  };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.baseDir, { recursive: true, force: true });
}

async function resolveExplicitAppTarget(fixture, {
  explicitTarget,
  groups,
  cwd
}) {
  try {
    const { stdout } = await runCliCommonShell(fixture, {
      explicitTarget,
      groups,
      cwd,
      scriptBody: `resolve_app_scope_target_json`
    });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(String(error?.stderr ?? error?.message ?? error));
  }
}

function runCliCommonShell(fixture, {
  explicitTarget,
  groups,
  cwd,
  scriptBody
}) {
  const script = [
    `source ${shellQuote(cliCommonPath)}`,
    `cli_init ${shellQuote(cliEntrypoint)}`,
    `TENANTS_BASE=${shellQuote(fixture.tenantsBase)}`,
    scriptBody
  ].join(`\n`);

  return execFileAsync(`bash`, [`-lc`, script], {
    cwd,
    env: {
      ...process.env,
      EHECOATL_CLI_USERNAME: `tester`,
      EHECOATL_CLI_GROUPS: groups.join(` `),
      EHECOATL_CLI_EXPLICIT_APP_TARGET: explicitTarget
    }
  });
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}
