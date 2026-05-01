'use strict';

require(`../utils/register-module-aliases`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const { buildManagedLoginWorkspacePlan } = require(`@/cli/lib/managed-login-workspace`);

function createTenantFixture() {
  const tenantsBase = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-login-workspace-`));
  const tenantRoot = path.join(tenantsBase, `tenant_example.test`);
  const appRoot = path.join(tenantRoot, `app_portal`);

  fs.mkdirSync(path.join(appRoot, `config`), { recursive: true });
  fs.writeFileSync(path.join(tenantRoot, `config.json`), JSON.stringify({
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.test`
  }, null, 2) + `\n`);
  fs.writeFileSync(path.join(appRoot, `config`, `app.json`), JSON.stringify({
    appId: `bbbbbb`,
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
        `@example.test`
      ]
    });

    assert.deepEqual(plan.resolvedGroups, [`g_aaaaaaaaaaaa`]);
    assert.deepEqual(
      plan.workspaceLinks.map((entry) => ({
        relativePath: entry.relativePath,
        targetPath: entry.targetPath
      })),
      [
        {
          relativePath: `@example.test`,
          targetPath: fixture.tenantRoot
        }
      ]
    );
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});

test(`managed login workspace resolves app selectors by tenant domain and tenant id`, () => {
  const fixture = createTenantFixture();

  try {
    const byDomain = buildManagedLoginWorkspacePlan({
      tenantsBase: fixture.tenantsBase,
      workspaceHome: `/home/appdev/ehecoatl`,
      scopeSelectors: [
        `portal@example.test`
      ]
    });
    const byTenantId = buildManagedLoginWorkspacePlan({
      tenantsBase: fixture.tenantsBase,
      workspaceHome: `/home/appdev/ehecoatl`,
      scopeSelectors: [
        `portal@aaaaaaaaaaaa`
      ]
    });

    assert.deepEqual(byDomain.resolvedGroups, [`g_aaaaaaaaaaaa_bbbbbb`]);
    assert.deepEqual(byTenantId.resolvedGroups, [`g_aaaaaaaaaaaa_bbbbbb`]);
    assert.deepEqual(
      byDomain.workspaceLinks.map((entry) => ({
        relativePath: entry.relativePath,
        targetPath: entry.targetPath
      })),
      [
        {
          relativePath: `portal@example.test`,
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
        `@example.test`,
        `@aaaaaaaaaaaa`,
        `portal@example.test`,
        `portal@aaaaaaaaaaaa`
      ]
    });

    assert.deepEqual(plan.resolvedGroups, [`g_aaaaaaaaaaaa`, `g_aaaaaaaaaaaa_bbbbbb`]);
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
        `@example.test`
      ]
    });

    assert.equal(plan.workspaceLinks.some((entry) => entry.relativePath === `tenants`), true);
    assert.equal(
      plan.workspaceLinks.some((entry) => entry.relativePath === `@example.test`),
      false
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
        scopeSelectors: [`@missing.test`]
      }),
      /Tenant selector '@missing\.test' not found\./
    );
  } finally {
    fs.rmSync(fixture.tenantsBase, { recursive: true, force: true });
  }
});
