'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const ManagedProcess = require(`@/_core/runtimes/process-fork-runtime/managed-process`);
const {
  getRenderedProcessIdentity
} = require(`@/contracts/utils`);
const appScopeContract = require(`@/contracts/layers/app-scope.contract.js`);
const {
  applyProcessIdentityFromEnv
} = require(`@/utils/process/apply-process-identity`);
const {
  getRenderedTenantFilesystemIdentity,
  getRenderedAppFilesystemIdentity,
  getRenderedScopeShellIdentity,
  getRenderedScopeProcessIdentity
} = require(`@/cli/lib/contract-identity.js`);

test(`getRenderedProcessIdentity renders templated thirdGroup when present`, () => {
  const originalThirdGroup = appScopeContract.ACTORS.PROCESSES.isolatedRuntime.identity.thirdGroup;

  try {
    appScopeContract.ACTORS.PROCESSES.isolatedRuntime.identity.thirdGroup = `g_extra_{tenant_id}_{app_id}`;
    const identity = getRenderedProcessIdentity(`appScope`, `isolatedRuntime`, {
      tenant_id: `aaaaaaaaaaaa`,
      app_id: `bbbbbbbbbbbb`
    });

    assert.equal(identity.user, `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`);
    assert.equal(identity.group, `g_tenantScope_aaaaaaaaaaaa`);
    assert.equal(identity.thirdGroup, `g_extra_aaaaaaaaaaaa_bbbbbbbbbbbb`);
  } finally {
    appScopeContract.ACTORS.PROCESSES.isolatedRuntime.identity.thirdGroup = originalThirdGroup;
  }
});

test(`managed process propagates second and third groups into child env`, () => {
  let spawned = null;
  const managed = new ManagedProcess((options) => {
    spawned = options;
    return { pid: 1234 };
  }, {
    label: `demo`,
    path: `@/bootstrap/bootstrap-demo`,
    cwd: process.cwd(),
    processUser: `u_demo`,
    processGroup: `g_demo`,
    processSecondGroup: `g_second`,
    processThirdGroup: `g_third`,
    variables: [],
    serialization: `advanced`,
    env: { DEMO: `1` }
  });

  assert.equal(managed.processSecondGroup, `g_second`);
  assert.equal(managed.processThirdGroup, `g_third`);
  assert.equal(spawned.env.PROCESS_SECOND_GROUP, `g_second`);
  assert.equal(spawned.env.PROCESS_THIRD_GROUP, `g_third`);
});

test(`applyProcessIdentityFromEnv applies up to two supplementary groups in deterministic order`, () => {
  const calls = [];
  const processAdapter = {
    platform: `linux`,
    getuid: () => 0,
    getgid: () => 50,
    getgroups: () => [],
    setgroups: (groups) => calls.push({ type: `setgroups`, groups }),
    setgid: (gid) => calls.push({ type: `setgid`, gid }),
    setuid: (uid) => calls.push({ type: `setuid`, uid })
  };
  const env = {
    PROCESS_USER: `u_demo`,
    PROCESS_GROUP: `g_primary`,
    PROCESS_SECOND_GROUP: `g_second`,
    PROCESS_THIRD_GROUP: `g_third`
  };
  const userIds = new Map([[`u_demo`, 1001]]);
  const groupIds = new Map([
    [`g_primary`, 2001],
    [`g_second`, 2002],
    [`g_third`, 2003]
  ]);

  const result = applyProcessIdentityFromEnv({
    env,
    processAdapter,
    resolveUserIdFn: (user) => userIds.get(user),
    resolveGroupIdFn: (group) => groupIds.get(group)
  });

  assert.equal(result.applied, true);
  assert.deepEqual(calls, [
    { type: `setgroups`, groups: [2002, 2003] },
    { type: `setgid`, gid: 2001 },
    { type: `setuid`, uid: 1001 }
  ]);
});

test(`contract identity helper resolves filesystem, shell, and process identities concretely`, () => {
  assert.deepEqual(
    getRenderedTenantFilesystemIdentity(`aaaaaaaaaaaa`),
    {
      owner: `u_tenant_aaaaaaaaaaaa`,
      group: `g_tenantScope_aaaaaaaaaaaa`,
      mode: `2770`,
      recursive: true
    }
  );

  assert.deepEqual(
    getRenderedAppFilesystemIdentity(`aaaaaaaaaaaa`, `bbbbbbbbbbbb`),
    {
      owner: `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      group: `g_tenantScope_aaaaaaaaaaaa`,
      mode: `2770`,
      recursive: true
    }
  );

  assert.deepEqual(
    getRenderedScopeShellIdentity(`appScope`, {
      tenantId: `aaaaaaaaaaaa`,
      appId: `bbbbbbbbbbbb`
    }),
    {
      user: `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      group: `g_appScope_aaaaaaaaaaaa_bbbbbbbbbbbb`
    }
  );

  assert.deepEqual(
    getRenderedScopeProcessIdentity(`tenantScope`, `transport`, {
      tenantId: `aaaaaaaaaaaa`
    }),
    {
      key: `transport`,
      label: `e_transport_aaaaaaaaaaaa`,
      user: `u_tenant_aaaaaaaaaaaa`,
      group: `g_tenantScope_aaaaaaaaaaaa`,
      secondGroup: null,
      thirdGroup: null
    }
  );
});
