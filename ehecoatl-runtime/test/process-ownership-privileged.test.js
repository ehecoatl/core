'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const { execFileSync, spawnSync } = require(`node:child_process`);

test(`dedicated tenant/app users can rely on owner plus tenant group without ACLs`, async (t) => {
  if (spawnSync(`sudo`, [`-n`, `true`], { stdio: `ignore` }).status !== 0) {
    t.skip(`sudo -n is not available in this environment`);
    return;
  }

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-8);
  const tenantGroup1 = `ehtg1_${suffix}`;
  const appGroup1 = `ehag1_${suffix}`;
  const tenantUser1 = `ehtu1_${suffix}`;
  const appUser1 = `ehau1_${suffix}`;
  const tenantGroup2 = `ehtg2_${suffix}`;
  const appGroup2 = `ehag2_${suffix}`;
  const tenantUser2 = `ehtu2_${suffix}`;
  const appUser2 = `ehau2_${suffix}`;
  const groups = [tenantGroup1, appGroup1, tenantGroup2, appGroup2];
  const users = [tenantUser1, appUser1, tenantUser2, appUser2];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-ownership-`));

  const varBase = path.join(tempRoot, `var`, `opt`, `ehecoatl`);
  const tenantsBase = path.join(varBase, `tenants`);
  const tenant1Dir = path.join(tenantsBase, `tenant_aaaaaaaaaaaa`);
  const tenant2Dir = path.join(tenantsBase, `tenant_bbbbbbbbbbbb`);
  const app1Dir = path.join(tenant1Dir, `app_cccccccccccc`);
  const app2Dir = path.join(tenant2Dir, `app_dddddddddddd`);
  const tenant1Shared = path.join(tenant1Dir, `shared.txt`);
  const app1File = path.join(app1Dir, `app.txt`);
  const app2File = path.join(app2Dir, `app.txt`);
  const protectedDir = path.join(tempRoot, `internal`);
  const protectedFile = path.join(protectedDir, `secret.txt`);

  t.after(() => {
    for (const user of users.slice().reverse()) {
      spawnSync(`sudo`, [`-n`, `userdel`, user], { stdio: `ignore` });
    }
    for (const group of groups.slice().reverse()) {
      spawnSync(`sudo`, [`-n`, `groupdel`, group], { stdio: `ignore` });
    }
    spawnSync(`sudo`, [`-n`, `rm`, `-rf`, tempRoot], { stdio: `ignore` });
  });

  for (const group of groups) {
    execFileSync(`sudo`, [`-n`, `groupadd`, `--system`, group], { stdio: `ignore` });
  }

  execFileSync(`sudo`, [`-n`, `useradd`, `--system`, `--gid`, tenantGroup1, `--no-create-home`, `--shell`, `/usr/sbin/nologin`, tenantUser1], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `useradd`, `--system`, `--gid`, appGroup1, `--no-create-home`, `--shell`, `/usr/sbin/nologin`, appUser1], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `useradd`, `--system`, `--gid`, tenantGroup2, `--no-create-home`, `--shell`, `/usr/sbin/nologin`, tenantUser2], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `useradd`, `--system`, `--gid`, appGroup2, `--no-create-home`, `--shell`, `/usr/sbin/nologin`, appUser2], { stdio: `ignore` });

  execFileSync(`sudo`, [`-n`, `mkdir`, `-p`, app1Dir, app2Dir, protectedDir], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `bash`, `-lc`, [
    `printf "tenant-one" > '${tenant1Shared}'`,
    `printf "app-one" > '${app1File}'`,
    `printf "app-two" > '${app2File}'`,
    `printf "secret" > '${protectedFile}'`
  ].join(` && `)], { stdio: `ignore` });

  execFileSync(`sudo`, [`-n`, `chmod`, `0711`, tempRoot], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chown`, `root:root`, varBase, tenantsBase, protectedDir, protectedFile], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chmod`, `0711`, varBase, tenantsBase], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chmod`, `0750`, protectedDir], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chmod`, `0640`, protectedFile], { stdio: `ignore` });

  execFileSync(`sudo`, [`-n`, `chown`, `-R`, `${tenantUser1}:${tenantGroup1}`, tenant1Dir], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chown`, `${appUser1}:${tenantGroup1}`, app1Dir, app1File], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chown`, `-R`, `${tenantUser2}:${tenantGroup2}`, tenant2Dir], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chown`, `${appUser2}:${tenantGroup2}`, app2Dir, app2File], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chmod`, `2770`, tenant1Dir, tenant2Dir, app1Dir, app2Dir], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `chmod`, `0660`, tenant1Shared, app1File, app2File], { stdio: `ignore` });

  execFileSync(`sudo`, [`-n`, `-u`, tenantUser1, `bash`, `-lc`, `test -r '${tenant1Shared}' && test -r '${app1File}'`], { stdio: `ignore` });
  execFileSync(`sudo`, [`-n`, `-u`, appUser1, `-g`, tenantGroup1, `bash`, `-lc`, `test -r '${tenant1Shared}' && printf 'x' >> '${app1File}'`], { stdio: `ignore` });

  const crossTenantRead = spawnSync(`sudo`, [`-n`, `-u`, appUser1, `-g`, tenantGroup1, `bash`, `-lc`, `cat '${app2File}' >/dev/null`], { stdio: `ignore` });
  assert.notEqual(crossTenantRead.status, 0);

  const internalRead = spawnSync(`sudo`, [`-n`, `-u`, tenantUser1, `bash`, `-lc`, `cat '${protectedFile}' >/dev/null`], { stdio: `ignore` });
  assert.notEqual(internalRead.status, 0);
});
