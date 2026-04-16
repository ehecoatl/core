'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const WebServerServicePort = require(`@/_core/_ports/outbound/web-server-service-port`);
require(`@/extensions/adapters/outbound/web-server-service/nginx`);

test(`nginx web-server adapter renders tenant config from the tenant-local template`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-nginx-source-`));
  const managedConfigDir = path.join(tempRoot, `nginx-managed`);
  const tenantRoot = path.join(tempRoot, `tenant_aaaaaaaaaaaa`);
  const config = {
    managedConfigDir,
    managedConfigPrefix: `tenant_`,
    defaultTenantKitBaseDir: path.join(__dirname, `..`, `extensions`, `tenant-kits`),
    nginxTestCommand: [process.execPath, `-e`, `process.exit(0)`],
    nginxReloadCommand: [process.execPath, `-e`, `process.exit(0)`]
  };
  const source = {
    key: `example.com`,
    kind: `tenant-primary`,
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.com`,
    domain: `example.com`,
    tenantRoot,
    internalProxy: {
      httpPort: 14002,
      wsPort: 14003
    }
  };

  await WebServerServicePort.setupServerAdapter(config);
  const updateResult = await WebServerServicePort.updateSourceAdapter(source, `tenant`, config);
  const renderedConfigPath = path.join(managedConfigDir, `tenant_example.com.conf`);
  const tenantTemplatePath = path.join(tenantRoot, `.ehecoatl`, `lib`, `nginx.e.conf`);
  const renderedConfig = fs.readFileSync(renderedConfigPath, `utf8`);

  assert.equal(updateResult.changed, true);
  assert.equal(fs.existsSync(tenantTemplatePath), true);
  assert.match(renderedConfig, /server_name example\.com \*\.example\.com;/);
  assert.match(renderedConfig, /location \^~ \/_ehecoatl_internal\/static\/ \{/);
  assert.match(renderedConfig, /alias .*tenant_aaaaaaaaaaaa\/;/);
  assert.match(renderedConfig, /location \^~ \/_ehecoatl_internal\/cache\/ \{/);
  assert.match(renderedConfig, /alias .*tenant_aaaaaaaaaaaa\/\.ehecoatl\/\.cache\/;/);
  assert.match(renderedConfig, /location = \/ws \{/);
  assert.match(renderedConfig, /location \^~ \/ws\/ \{/);
  assert.match(renderedConfig, /location ~ \^\(\.\+\?\)\/\+\$ \{/);
  assert.match(renderedConfig, /return 308 \$scheme:\/\/\$host\$1\$is_args\$args;/);
  assert.match(renderedConfig, /proxy_pass http:\/\/127\.0\.0\.1:14002;/);
  assert.match(renderedConfig, /proxy_pass http:\/\/127\.0\.0\.1:14003;/);
  assert.match(renderedConfig, /proxy_set_header X-Ehecoatl-Target-App-Id "";/);
  assert.match(renderedConfig, /limit_req_zone \$binary_remote_addr zone=ehecoatl_req_example_com:10m rate=10r\/s;/);
  assert.match(renderedConfig, /limit_conn_zone \$binary_remote_addr zone=ehecoatl_conn_example_com:10m;/);

  const flushResult = await WebServerServicePort.flushChangesAdapter(config);
  assert.deepEqual(flushResult, {
    changed: true,
    tested: true,
    reloaded: true
  });

  const removeResult = await WebServerServicePort.removeSourceAdapter(`example.com`, config);
  assert.equal(removeResult.changed, true);
  assert.equal(fs.existsSync(renderedConfigPath), false);
});

test(`nginx source renderer can expose generic tls without forcing https redirect`, async () => {
  const { renderTenantTemplate } = require(`@/extensions/adapters/outbound/web-server-service/nginx/source-renderer`);
  const templateContent = fs.readFileSync(
    path.join(__dirname, `..`, `extensions`, `tenant-kits`, `empty-tenant`, `.ehecoatl`, `lib`, `nginx.e.conf`),
    `utf8`
  );

  const renderedConfig = renderTenantTemplate(templateContent, {
    tenantId: `bbbbbbbbbbbb`,
    tenantDomain: `fallback.test`,
    tenantRoot: `/var/opt/ehecoatl/tenants/tenant_bbbbbbbbbbbb`,
    aliases: [],
    internalProxy: {
      httpPort: 14012,
      wsPort: 14013
    },
    effectiveTls: {
      mode: `generic`,
      certPath: `/var/lib/ehecoatl/ssl/generic.fullchain.pem`,
      keyPath: `/var/lib/ehecoatl/ssl/generic.privkey.pem`,
      httpsEnabled: true,
      httpRedirectToHttps: false
    }
  });

  assert.match(renderedConfig, /ssl_certificate \/var\/lib\/ehecoatl\/ssl\/generic\.fullchain\.pem;/);
  assert.match(renderedConfig, /ssl_certificate_key \/var\/lib\/ehecoatl\/ssl\/generic\.privkey\.pem;/);
  assert.match(renderedConfig, /location \^~ \/_ehecoatl_internal\/static\/ \{/);
  assert.match(renderedConfig, /location \^~ \/_ehecoatl_internal\/cache\/ \{/);
  assert.match(renderedConfig, /location = \/ws \{/);
  assert.match(renderedConfig, /location \^~ \/ws\/ \{/);
  assert.match(renderedConfig, /location ~ \^\(\.\+\?\)\/\+\$ \{/);
  assert.match(renderedConfig, /location \/ \{/);
  assert.match(renderedConfig, /proxy_pass http:\/\/127\.0\.0\.1:14012;/);
  assert.doesNotMatch(renderedConfig, /return 301 https:\/\/\$host\$request_uri;/);
});

test(`nginx source renderer injects direct app target header only for app alias domains`, () => {
  const { renderTenantTemplate } = require(`@/extensions/adapters/outbound/web-server-service/nginx/source-renderer`);
  const templateContent = fs.readFileSync(
    path.join(__dirname, `..`, `extensions`, `tenant-kits`, `empty-tenant`, `.ehecoatl`, `lib`, `nginx.e.conf`),
    `utf8`
  );

  const renderedConfig = renderTenantTemplate(templateContent, {
    kind: `app-alias`,
    tenantId: `bbbbbbbbbbbb`,
    tenantDomain: `example.test`,
    domain: `admin-short.test`,
    tenantRoot: `/var/opt/ehecoatl/tenants/tenant_bbbbbbbbbbbb`,
    forcedAppId: `cccccccccccc`,
    internalProxy: {
      httpPort: 14012,
      wsPort: 14013
    },
    effectiveTls: {
      mode: `generic`,
      certPath: `/var/lib/ehecoatl/ssl/generic.fullchain.pem`,
      keyPath: `/var/lib/ehecoatl/ssl/generic.privkey.pem`,
      httpsEnabled: true,
      httpRedirectToHttps: false
    }
  });

  assert.match(renderedConfig, /server_name admin-short\.test;/);
  assert.doesNotMatch(renderedConfig, /\*\.admin-short\.test/);
  assert.match(renderedConfig, /proxy_set_header X-Ehecoatl-Target-App-Id cccccccccccc;/);
});

test(`nginx source renderer uses domain-specific zone names for app hosts too`, () => {
  const { renderTenantTemplate } = require(`@/extensions/adapters/outbound/web-server-service/nginx/source-renderer`);
  const templateContent = fs.readFileSync(
    path.join(__dirname, `..`, `extensions`, `tenant-kits`, `empty-tenant`, `.ehecoatl`, `lib`, `nginx.e.conf`),
    `utf8`
  );

  const renderedConfig = renderTenantTemplate(templateContent, {
    kind: `app-default-root`,
    tenantId: `bbbbbbbbbbbb`,
    tenantDomain: `example.test`,
    domain: `example.test`,
    tenantRoot: `/var/opt/ehecoatl/tenants/tenant_bbbbbbbbbbbb`,
    forcedAppId: `cccccccccccc`,
    internalProxy: {
      httpPort: 14012,
      wsPort: 14013
    },
    effectiveTls: {
      mode: `generic`,
      certPath: `/var/lib/ehecoatl/ssl/generic.fullchain.pem`,
      keyPath: `/var/lib/ehecoatl/ssl/generic.privkey.pem`,
      httpsEnabled: true,
      httpRedirectToHttps: false
    }
  });

  assert.match(renderedConfig, /limit_req_zone \$binary_remote_addr zone=ehecoatl_req_example_test:10m rate=10r\/s;/);
  assert.match(renderedConfig, /limit_conn_zone \$binary_remote_addr zone=ehecoatl_conn_example_test:10m;/);
  assert.match(renderedConfig, /proxy_set_header X-Ehecoatl-Target-App-Id cccccccccccc;/);
});

test(`nginx web-server adapter prefers letsencrypt live certs for the raw domain before generic fallback`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-nginx-letsencrypt-`));
  const managedConfigDir = path.join(tempRoot, `nginx-managed`);
  const tenantRoot = path.join(tempRoot, `tenant_aaaaaaaaaaaa`);
  const letsEncryptLiveDir = path.join(tempRoot, `letsencrypt`, `live`);
  const domainLiveDir = path.join(letsEncryptLiveDir, `alias.test`);
  fs.mkdirSync(domainLiveDir, { recursive: true });
  fs.writeFileSync(path.join(domainLiveDir, `fullchain.pem`), `CERT`);
  fs.writeFileSync(path.join(domainLiveDir, `privkey.pem`), `KEY`);

  const config = {
    managedConfigDir,
    managedConfigPrefix: `tenant_`,
    defaultTenantKitBaseDir: path.join(__dirname, `..`, `extensions`, `tenant-kits`),
    nginxTestCommand: [process.execPath, `-e`, `process.exit(0)`],
    nginxReloadCommand: [process.execPath, `-e`, `process.exit(0)`],
    getCertificatePath: async (domain) => {
      if (domain !== `alias.test`) return null;
      return {
        domain,
        fullchainPath: path.join(letsEncryptLiveDir, `alias.test`, `fullchain.pem`),
        privkeyPath: path.join(letsEncryptLiveDir, `alias.test`, `privkey.pem`)
      };
    }
  };
  const source = {
    key: `alias.test`,
    kind: `tenant-alias`,
    routeType: `tenant`,
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.com`,
    domain: `alias.test`,
    tenantRoot,
    internalProxy: {
      httpPort: 14002,
      wsPort: 14003
    }
  };

  await WebServerServicePort.setupServerAdapter(config);
  await WebServerServicePort.updateSourceAdapter(source, `tenant`, config);
  const renderedConfigPath = path.join(managedConfigDir, `tenant_alias.test.conf`);
  const renderedConfig = fs.readFileSync(renderedConfigPath, `utf8`);

  assert.match(renderedConfig, /ssl_certificate .*letsencrypt\/live\/alias\.test\/fullchain\.pem;/);
  assert.match(renderedConfig, /ssl_certificate_key .*letsencrypt\/live\/alias\.test\/privkey\.pem;/);
});

test(`nginx web-server adapter can flush through privileged host callback`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-nginx-privileged-`));
  const managedConfigDir = path.join(tempRoot, `nginx-managed`);
  const tenantRoot = path.join(tempRoot, `tenant_aaaaaaaaaaaa`);
  const calls = [];
  const config = {
    managedConfigDir,
    managedConfigPrefix: `tenant_`,
    defaultTenantKitBaseDir: path.join(__dirname, `..`, `extensions`, `tenant-kits`),
    nginxTestCommand: [process.execPath, `-e`, `process.exit(7)`],
    nginxReloadCommand: [process.execPath, `-e`, `process.exit(9)`],
    privilegedHostOperation: async (operation, payload) => {
      calls.push({ operation, payload });
      return { ok: true };
    }
  };
  const source = {
    key: `example.net`,
    kind: `tenant-primary`,
    tenantId: `aaaaaaaaaaaa`,
    tenantDomain: `example.net`,
    domain: `example.net`,
    tenantRoot,
    internalProxy: {
      httpPort: 14002,
      wsPort: 14003
    }
  };

  await WebServerServicePort.setupServerAdapter(config);
  await WebServerServicePort.updateSourceAdapter(source, `tenant`, config);
  const flushResult = await WebServerServicePort.flushChangesAdapter(config);

  assert.deepEqual(flushResult, {
    changed: true,
    tested: true,
    reloaded: true
  });
  assert.ok(calls.length >= 2);
  assert.equal(calls.at(-1).operation, `nginx.reload`);
  assert.deepEqual(calls.at(-1).payload.reloadCommand, [`systemctl`, `reload`, `nginx`]);
  assert.deepEqual(calls.at(-1).payload.testCommand, [process.execPath, `-e`, `process.exit(7)`]);
  assert.equal(calls.some((entry) => entry.operation === `nginx.ensureManagedConfigDir`), true);
  assert.deepEqual(
    calls.find((entry) => entry.operation === `nginx.ensureManagedConfigDir`)?.payload,
    {
      targetDir: managedConfigDir,
      owner: `ehecoatl`,
      group: `g_directorScope`,
      mode: `2770`
    }
  );
  assert.equal(calls.some((entry) => entry.operation === `nginx.writeManagedSource`), false);
});
