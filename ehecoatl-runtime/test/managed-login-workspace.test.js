'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const { buildManagedLoginWorkspacePlan } = require(`@/cli/lib/managed-login-workspace`);

function createTenantFixture() {
  const tenantsBase = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-login-workspace-`));
  const tenantRoot = path.join(tenantsBase, `tenant_aaaaaaaaaaaa`);
  const appRoot = path.join(tenantRoot, `app_bbbbbbbbbbbb`);

  fs.mkdirSync(path.join(appRoot, `config`), { recursive: true });
  fs.writeFileSync(path.join(tenantRoot, `config.json`), JSON.stringify({
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.test`
  }, null, 2) + `\n`);
  fs.writeFileSync(path.join(appRoot, `config`, `app.json`), JSON.stringify({
    appId: `bbbbbbbbbbbb`,
    appName: `portal`
  }, null, 2) + `\n`);

  return {
    tenantsBase,
    tenantRoot,
    appRoot
  };
}

test(`managed login workspace builds curated super-scope links`, () => {
  const plan = buildManagedLoginWorkspacePlan({
    workspaceHome: `/home/operator/ehecoatl`,
    scopeSelectors: [`super`]
  });

  assert.deepEqual(plan.resolvedGroups, [`g_superScope`]);
  assert.deepEqual(
    plan.workspaceLinks.map((entry) => ({
      relativePath: entry.relativePath,
      targetPath: entry.targetPath
    })),
    [
      { relativePath: `config`, targetPath: `/etc/opt/ehecoatl/config` },
      { relativePath: `srv`, targetPath: `/srv/opt/ehecoatl` },
      { relativePath: `tenants`, targetPath: `/var/opt/ehecoatl/tenants` },
      { relativePath: `logs`, targetPath: `/var/log/ehecoatl` },
      { relativePath: `var`, targetPath: `/var/opt/ehecoatl` },
      { relativePath: `runtime`, targetPath: `/var/lib/ehecoatl` }
    ]
  );
});

test(`managed login workspace resolves tenant and app selectors into scoped links`, () => {
  const fixture = createTenantFixture();

  try {
    const plan = buildManagedLoginWorkspacePlan({
      tenantsBase: fixture.tenantsBase,
      workspaceHome: `/home/editor/ehecoatl`,
      scopeSelectors: [
        `tenant:@example.test`,
        `app:portal@example.test`
      ]
    });

    assert.deepEqual(plan.resolvedGroups, [
      `g_aaaaaaaaaaaa`,
      `g_aaaaaaaaaaaa_bbbbbbbbbbbb`
    ]);
    assert.deepEqual(
      plan.workspaceLinks.map((entry) => ({
        relativePath: entry.relativePath,
        targetPath: entry.targetPath
      })),
      [
        {
          relativePath: path.join(`tenants`, `tenant_aaaaaaaaaaaa`),
          targetPath: fixture.tenantRoot
        },
        {
          relativePath: path.join(`apps`, `app_bbbbbbbbbbbb`),
          targetPath: fixture.appRoot
        }
      ]
    );
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});

test(`managed login workspace de-duplicates repeated selectors that resolve to the same tenant and app`, () => {
  const fixture = createTenantFixture();

  try {
    const plan = buildManagedLoginWorkspacePlan({
      tenantsBase: fixture.tenantsBase,
      workspaceHome: `/home/editor/ehecoatl`,
      scopeSelectors: [
        `tenant:@example.test`,
        `tenant:@aaaaaaaaaaaa`,
        `app:portal@example.test`,
        `app:bbbbbbbbbbbb@aaaaaaaaaaaa`
      ]
    });

    assert.deepEqual(plan.resolvedGroups, [
      `g_aaaaaaaaaaaa`,
      `g_aaaaaaaaaaaa_bbbbbbbbbbbb`
    ]);
    assert.equal(plan.workspaceLinks.length, 2);
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});

test(`managed login workspace keeps super tenants root and skips nested tenant symlinks when super is present`, () => {
  const fixture = createTenantFixture();

  try {
    const plan = buildManagedLoginWorkspacePlan({
      tenantsBase: fixture.tenantsBase,
      workspaceHome: `/home/operator/ehecoatl`,
      scopeSelectors: [
        `super`,
        `tenant:@example.test`,
        `app:portal@example.test`
      ]
    });

    assert.equal(plan.workspaceLinks.some((entry) => entry.relativePath === `tenants`), true);
    assert.equal(
      plan.workspaceLinks.some((entry) => entry.relativePath === path.join(`tenants`, `tenant_aaaaaaaaaaaa`)),
      false
    );
    assert.equal(
      plan.workspaceLinks.some((entry) => entry.relativePath === path.join(`apps`, `app_bbbbbbbbbbbb`)),
      true
    );
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});

test(`managed login workspace rejects selectors that do not resolve to existing scopes`, () => {
  const fixture = createTenantFixture();

  try {
    assert.throws(
      () => buildManagedLoginWorkspacePlan({
        tenantsBase: fixture.tenantsBase,
        workspaceHome: `/home/editor/ehecoatl`,
        scopeSelectors: [`tenant:@missing.test`]
      }),
      /Tenant selector 'tenant:@missing\.test' not found\./
    );

    assert.throws(
      () => buildManagedLoginWorkspacePlan({
        tenantsBase: fixture.tenantsBase,
        workspaceHome: `/home/editor/ehecoatl`,
        scopeSelectors: [`app:missing@example.test`]
      }),
      /App selector 'app:missing@example\.test' not found\./
    );
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});
