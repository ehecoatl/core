'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const {
  cleanupManagedCgroups,
  ensureManagedCgroup,
  registerManagedCgroupPid,
  releaseManagedCgroup
} = require(`@/scripts/managed-cgroups`);
const {
  attachCurrentProcessToManagedCgroup
} = require(`@/utils/process/attach-managed-cgroup`);

test(`managed cgroups create unique limited cgroup entries and cleanup released empty groups`, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-cgroups-`));
  const cgroupFsRoot = path.join(tempDir, `cgroup`);
  const serviceCgroup = `/system.slice/ehecoatl.service`;
  const servicePath = path.join(cgroupFsRoot, `system.slice`, `ehecoatl.service`);
  const registryFile = path.join(tempDir, `registry`, `managed-cgroups.json`);
  fs.mkdirSync(servicePath, { recursive: true });
  fs.writeFileSync(path.join(servicePath, `cgroup.controllers`), `cpu memory pids`);
  fs.writeFileSync(path.join(servicePath, `cgroup.subtree_control`), ``);

  const first = await ensureManagedCgroup({
    label: `e_app_test`,
    cgroups: {
      memoryMaxMb: 128,
      cpuMaxPercent: 25
    },
    cgroupFsRoot,
    serviceCgroup,
    registryFile
  });
  const second = await ensureManagedCgroup({
    label: `e_app_test`,
    cgroups: {
      memoryMaxMb: 192,
      cpuMaxPercent: 50
    },
    cgroupFsRoot,
    serviceCgroup,
    registryFile
  });

  assert.notEqual(first.id, second.id);
  assert.equal(fs.readFileSync(path.join(first.cgroupPath, `memory.max`), `utf8`), String(128 * 1024 * 1024));
  assert.equal(fs.readFileSync(path.join(first.cgroupPath, `cpu.max`), `utf8`), `25000 100000`);
  assert.equal(fs.readFileSync(path.join(first.cgroupPath, `memory.oom.group`), `utf8`), `1`);
  assert.match(fs.readFileSync(path.join(servicePath, `cgroup.subtree_control`), `utf8`), /\+memory|\+pids|\+cpu/);

  await registerManagedCgroupPid({
    id: first.id,
    pid: 999999,
    label: `e_app_test`,
    cgroupFsRoot,
    serviceCgroup,
    registryFile
  });
  let registry = JSON.parse(fs.readFileSync(registryFile, `utf8`));
  assert.equal(registry.entries.find((entry) => entry.id === first.id).pid, 999999);
  assert.equal(registry.entries.find((entry) => entry.id === first.id).state, `active`);

  await releaseManagedCgroup({
    id: first.id,
    cgroupFsRoot,
    serviceCgroup,
    registryFile
  });
  await cleanupManagedCgroups({
    cgroupFsRoot,
    serviceCgroup,
    registryFile
  });

  registry = JSON.parse(fs.readFileSync(registryFile, `utf8`));
  assert.equal(registry.entries.some((entry) => entry.id === first.id), false);
  assert.equal(fs.existsSync(first.cgroupPath), false);
});

test(`managed cgroup bootstrap attach writes current pid before privilege drop`, () => {
  const writes = [];
  const fsAdapter = {
    writeFileSync(filePath, value) {
      writes.push({ filePath, value });
    }
  };

  const result = attachCurrentProcessToManagedCgroup({
    pid: 1234,
    env: {
      EHECOATL_CGROUP_ID: `cg_test`,
      EHECOATL_CGROUP_PATH: `/sys/fs/cgroup/system.slice/ehecoatl.service/ehecoatl-managed_cg_test`
    },
    fsAdapter
  });

  assert.equal(result.attached, true);
  assert.deepEqual(writes, [{
    filePath: `/sys/fs/cgroup/system.slice/ehecoatl.service/ehecoatl-managed_cg_test/cgroup.procs`,
    value: `1234`
  }]);
});
