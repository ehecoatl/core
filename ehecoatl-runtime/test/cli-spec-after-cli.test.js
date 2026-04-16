'use strict';

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const { execFile } = require(`node:child_process`);
const { promisify } = require(`node:util`);

const execFileAsync = promisify(execFile);

test(`cli spec after-cli renders core deploy tenant commands including rescan`, async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      `/home/ubuntu/shared/ehecoatl-runtime/cli/lib/cli-spec-cli.js`,
      `after-cli`,
      `core`,
      `deploy tenant`,
      JSON.stringify({
        tenant_id: `aaaaaaaaaaaa`,
        tenant_domain: `example.test`
      })
    ],
    {
      cwd: `/home/ubuntu/shared/ehecoatl-runtime`
    }
  );

  assert.deepEqual(JSON.parse(stdout), [
    `setfacl -R -m d:g:g_directorScope:rx /var/opt/ehecoatl/tenants/tenant_aaaaaaaaaaaa/shared/config`,
    `setfacl -R -m d:g:g_directorScope:rx /var/opt/ehecoatl/tenants/tenant_aaaaaaaaaaaa/shared/routes`,
    `ehecoatl core rescan tenants`
  ]);
});

test(`cli spec after-cli renders tenant deploy app commands including rescan`, async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      `/home/ubuntu/shared/ehecoatl-runtime/cli/lib/cli-spec-cli.js`,
      `after-cli`,
      `tenant`,
      `deploy app`,
      JSON.stringify({
        tenant_id: `aaaaaaaaaaaa`,
        app_id: `bbbbbbbbbbbb`,
        tenant_domain: `example.test`,
        app_name: `www`
      })
    ],
    {
      cwd: `/home/ubuntu/shared/ehecoatl-runtime`
    }
  );

  assert.deepEqual(JSON.parse(stdout), [
    `setfacl -R -m d:g:g_directorScope:rx /var/opt/ehecoatl/tenants/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/config`,
    `setfacl -R -m d:g:g_directorScope:rx /var/opt/ehecoatl/tenants/tenant_aaaaaaaaaaaa/app_bbbbbbbbbbbb/routes`,
    `ehecoatl core rescan tenants`
  ]);
});
