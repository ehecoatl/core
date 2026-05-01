'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const path = require(`node:path`);

const ManagedProcess = require(`@/_core/runtimes/process-fork-runtime/managed-process`);
const {
  getRenderedProcessIdentity
} = require(`@/contracts/utils`);
const appScopeContract = require(`@/contracts/layers/app-scope.contract.js`);
const {
  applyProcessIdentityFromEnv
} = require(`@/utils/process/apply-process-identity`);
const {
  dropConfiguredSupplementaryScopeGroups,
  finalizeRuntimeIsolation
} = require(`@/utils/process/finalize-runtime-isolation`);
const {
  getRenderedTenantFilesystemIdentity,
  getRenderedAppFilesystemIdentity,
  getRenderedScopePathEntry,
  getRenderedScopeShellIdentity,
  getRenderedScopeProcessIdentity
} = require(`@/cli/lib/contract-identity.js`);
const { deriveRuntimePolicy } = require(`@/contracts/derive-runtime-policy`);

test(`getRenderedProcessIdentity renders templated thirdGroup when present`, () => {
  const originalThirdGroup = appScopeContract.ACTORS.PROCESSES.isolatedRuntime.identity.thirdGroup;

  try {
    appScopeContract.ACTORS.PROCESSES.isolatedRuntime.identity.thirdGroup = `g_extra_{tenant_id}_{app_id}`;
    const identity = getRenderedProcessIdentity(`appScope`, `isolatedRuntime`, {
      tenant_id: `aaaaaaaaaaaa`,
      app_id: `bbbbbbbbbbbb`
    });

    assert.equal(identity.user, `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`);
    assert.equal(identity.group, `g_aaaaaaaaaaaa`);
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

test(`dropConfiguredSupplementaryScopeGroups removes only configured supplementary groups and preserves primary group`, () => {
  const calls = [];
  const result = dropConfiguredSupplementaryScopeGroups({
    env: {
      PROCESS_SECOND_GROUP: `g_superScope`,
      PROCESS_THIRD_GROUP: `ehecoatl`
    },
    processAdapter: {
      getgid: () => 2001,
      getgroups: () => [2001, 2002, 2003, 2999],
      setgroups: (groups) => calls.push(groups)
    },
    resolveGroupIdFn: (groupName) => ({
      g_superScope: 2002,
      ehecoatl: 2003
    })[groupName]
  });

  assert.equal(result.success, true);
  assert.equal(result.skipped, false);
  assert.deepEqual(result.droppedGroups, [`g_superScope`, `ehecoatl`]);
  assert.deepEqual(result.remainingGroups, [2999]);
  assert.deepEqual(calls, [[2999]]);
});

test(`finalizeRuntimeIsolation drops configured scope groups and then drops remaining capabilities`, () => {
  const calls = [];
  const result = finalizeRuntimeIsolation({
    env: {
      PROCESS_SECOND_GROUP: `g_superScope`,
      PROCESS_THIRD_GROUP: `ehecoatl`
    },
    processAdapter: {
      getgid: () => 2001,
      getgroups: () => [2001, 2002, 2003],
      setgroups: (groups) => calls.push({ type: `setgroups`, groups })
    },
    resolveGroupIdFn: (groupName) => ({
      g_superScope: 2002,
      ehecoatl: 2003
    })[groupName],
    dropCapabilitiesFn: () => {
      calls.push({ type: `dropAllCapabilities` });
      return { applied: true };
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.capabilitiesDropped, true);
  assert.deepEqual(result.droppedGroups, [`g_superScope`, `ehecoatl`]);
  assert.deepEqual(calls, [
    { type: `setgroups`, groups: [] },
    { type: `dropAllCapabilities` }
  ]);
});

test(`contract identity helper resolves filesystem, shell, and process identities concretely`, () => {
  assert.deepEqual(
    getRenderedTenantFilesystemIdentity(`aaaaaaaaaaaa`),
    {
      owner: `u_tenant_aaaaaaaaaaaa`,
      group: `g_aaaaaaaaaaaa`,
      mode: `2770`,
      recursive: true
    }
  );

  assert.deepEqual(
    getRenderedAppFilesystemIdentity(`aaaaaaaaaaaa`, `bbbbbbbbbbbb`, `example.com`, `www`),
    {
      owner: `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      group: `g_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      mode: `2775`,
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
      group: `g_aaaaaaaaaaaa_bbbbbbbbbbbb`
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
      group: `g_aaaaaaaaaaaa`,
      secondGroup: `g_superScope`,
      thirdGroup: `ehecoatl`
    }
  );
});

test(`app scope writable transport exceptions keep explicit contract modes`, () => {
  const variables = {
    tenantId: `aaaaaaaaaaaa`,
    appId: `bbbbbbbbbbbb`,
    tenantDomain: `example.com`,
    appName: `www`
  };

  assert.deepEqual(
    getRenderedScopePathEntry(`appScope`, `RUNTIME`, `uploads`, variables),
    {
      path: `/var/opt/ehecoatl/tenants/tenant_example.com/app_www/storage/uploads`,
      owner: `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      group: `g_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      mode: `2777`,
      recursive: true,
      type: `directory`
    }
  );

  assert.deepEqual(
    getRenderedScopePathEntry(`appScope`, `LOGS`, `debug`, variables),
    {
      path: `/var/opt/ehecoatl/tenants/tenant_example.com/app_www/.ehecoatl/log/debug`,
      owner: `u_app_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      group: `g_aaaaaaaaaaaa_bbbbbbbbbbbb`,
      mode: `2777`,
      recursive: true,
      type: `directory`
    }
  );
});

test(`derived runtime policy narrows app filesystem ownership while preserving process group`, () => {
  const policy = deriveRuntimePolicy();

  assert.equal(policy.processUsers.isolatedRuntime.group, `g_{tenant_id}`);
  assert.equal(policy.tenantLayout.appGroup, `g_{tenant_id}_{app_id}`);
  assert.equal(policy.tenantLayout.appMode, `2775`);
  assert.equal(policy.tenantLayout.appWritableDirMode, `2775`);
  assert.equal(policy.tenantLayout.appFileMode, `664`);
  assert.equal(policy.tenantLayout.appConfigMode, `664`);
});

test(`deploy app permissions follow app contract defaults and explicit writable exceptions`, () => {
  const deploySource = fs.readFileSync(
    path.join(__dirname, `..`, `cli`, `commands`, `shared`, `deploy.sh`),
    `utf8`
  );

  assert.match(
    deploySource,
    /apply_tree_mode "\$app_dir" "\$owner_user" "\$owner_group" "\$app_root_mode" "\$app_root_file_mode"/
  );
  assert.match(deploySource, /apply_contract_tree_mode "\$uploads_dir" "\$uploads_json"/);
  assert.match(deploySource, /apply_contract_tree_mode "\$log_debug_dir" "\$log_debug_json"/);
  assert.doesNotMatch(deploySource, /apply_tree_mode "\$app_dir" "\$owner_user" "\$owner_group" "2770" "0660"/);
  assert.doesNotMatch(deploySource, /\$system_dir\/\.log|\.ehecoatl\/\.log/);
});
