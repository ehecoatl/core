'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const CertificateService = require(`@/_core/services/certificate-service`);

test(`certificate-service triggers letsencrypt issuance once per cooldown window and persists the trigger marker`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-certificate-service-`));
  const adapterPath = path.join(tempRoot, `mock-certificate-adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  async getCertificatePathAdapter() {`,
    `    return null;`,
    `  }`,
    `};`
  ].join(`\n`), `utf8`);

  let triggerState = null;
  let triggerCalls = 0;
  let persistedPayloads = [];
  const kernelContext = {
    config: {
      _adapters: {
        certificateService: adapterPath
      },
      adapters: {
        certificateService: {
          triggerCooldownMs: 1000,
          defaultCertbotEmail: `default@example.test`,
          bootstrapLetsEncryptCommand: [`bash`, `/opt/ehecoatl/setup/bootstraps/bootstrap-lets-encrypt.sh`, `--yes`, `--non-interactive`],
          certbotIssueCommandTemplate: [`certbot`, `--nginx`, `-d`, `{domain}`]
        }
      }
    },
    useCases: {
      rpcEndpoint: {
        async ask({ target, question, data }) {
          triggerCalls += 1;
          assert.equal(target, `main`);
          assert.equal(question, `privilegedHostOperation`);
          assert.equal(data.operation, `certificate.issueLetsEncrypt`);
          assert.equal(data.payload.domain, `example.test`);
          assert.deepEqual(data.payload.issueCommandTemplate, [
            `certbot`,
            `--nginx`,
            `-d`,
            `example.test`,
            `--email`,
            `tenant@example.test`
          ]);
          return {
            success: true,
            result: {
              started: true,
              domain: `example.test`
            }
          };
        }
      },
      tenantRegistryResolver: {
        getTenantRecordById() {
          return {
            tenantId: `tenant_aaaaaaaaaaaa`,
            certbotEmail: `tenant@example.test`
          };
        },
        getLetsEncryptTriggerState() {
          return triggerState;
        },
        async markLetsEncryptTriggerStarted(_tenantId, _domain, nextState) {
          triggerState = nextState;
          persistedPayloads.push(nextState);
          return nextState;
        }
      }
    }
  };

  const certificateService = new CertificateService(kernelContext);

  const firstResult = await certificateService.getCertificatePath(`example.test`, `tenant_aaaaaaaaaaaa`);
  assert.equal(firstResult, null);
  assert.equal(triggerCalls, 1);
  assert.equal(persistedPayloads.length, 1);
  assert.match(String(triggerState?.source ?? ``), /certificate-service:auto-trigger/);
  assert.ok(Number(triggerState?.expiresAt ?? 0) > Number(triggerState?.startedAt ?? 0));

  const secondResult = await certificateService.getCertificatePath(`example.test`, `tenant_aaaaaaaaaaaa`);
  assert.equal(secondResult, null);
  assert.equal(triggerCalls, 1);
  assert.equal(persistedPayloads.length, 1);

  triggerState = {
    ...triggerState,
    expiresAt: Date.now() - 1
  };

  const thirdResult = await certificateService.getCertificatePath(`example.test`, `tenant_aaaaaaaaaaaa`);
  assert.equal(thirdResult, null);
  assert.equal(triggerCalls, 2);
  assert.equal(persistedPayloads.length, 2);
});

test(`certificate-service returns adapter certificate immediately and skips issuance trigger`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-certificate-service-hit-`));
  const adapterPath = path.join(tempRoot, `mock-certificate-adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  async getCertificatePathAdapter({ domain }) {`,
    `    return { domain, fullchainPath: '/tmp/fullchain.pem', privkeyPath: '/tmp/privkey.pem' };`,
    `  }`,
    `};`
  ].join(`\n`), `utf8`);

  let triggerCalls = 0;
  const kernelContext = {
    config: {
      _adapters: {
        certificateService: adapterPath
      },
      adapters: {
        certificateService: {
          triggerCooldownMs: 1000,
          defaultCertbotEmail: null
        }
      }
    },
    useCases: {
      rpcEndpoint: {
        async ask() {
          triggerCalls += 1;
          return { success: true, result: { started: true } };
        }
      },
      tenantRegistryResolver: {
        getTenantRecordById() {
          return {
            tenantId: `tenant_aaaaaaaaaaaa`,
            certbotEmail: null
          };
        },
        getLetsEncryptTriggerState() {
          return null;
        },
        async markLetsEncryptTriggerStarted() {
          throw new Error(`should not persist trigger when certificate already exists`);
        }
      }
    }
  };

  const certificateService = new CertificateService(kernelContext);
  const result = await certificateService.getCertificatePath(`example.test`, `tenant_aaaaaaaaaaaa`);

  assert.deepEqual(result, {
    domain: `example.test`,
    fullchainPath: `/tmp/fullchain.pem`,
    privkeyPath: `/tmp/privkey.pem`
  });
  assert.equal(triggerCalls, 0);
});

test(`certificate-service falls back to default adapter certbot email when tenant email is null`, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-certificate-service-default-email-`));
  const adapterPath = path.join(tempRoot, `mock-certificate-adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = {`,
    `  async getCertificatePathAdapter() {`,
    `    return null;`,
    `  }`,
    `};`
  ].join(`\n`), `utf8`);

  let observedIssueCommandTemplate = null;
  const kernelContext = {
    config: {
      _adapters: {
        certificateService: adapterPath
      },
      adapters: {
        certificateService: {
          triggerCooldownMs: 1000,
          defaultCertbotEmail: `default@example.test`,
          bootstrapLetsEncryptCommand: [`bash`, `/opt/ehecoatl/setup/bootstraps/bootstrap-lets-encrypt.sh`, `--yes`, `--non-interactive`],
          certbotIssueCommandTemplate: [`certbot`, `--nginx`, `-d`, `{domain}`]
        }
      }
    },
    useCases: {
      rpcEndpoint: {
        async ask({ data }) {
          observedIssueCommandTemplate = data.payload.issueCommandTemplate;
          return {
            success: true,
            result: {
              started: true,
              domain: `example.test`
            }
          };
        }
      },
      tenantRegistryResolver: {
        getTenantRecordById() {
          return {
            tenantId: `tenant_aaaaaaaaaaaa`,
            certbotEmail: null
          };
        },
        getLetsEncryptTriggerState() {
          return null;
        },
        async markLetsEncryptTriggerStarted() {
          return null;
        }
      }
    }
  };

  const certificateService = new CertificateService(kernelContext);
  await certificateService.getCertificatePath(`example.test`, `tenant_aaaaaaaaaaaa`);

  assert.deepEqual(observedIssueCommandTemplate, [
    `certbot`,
    `--nginx`,
    `-d`,
    `example.test`,
    `--email`,
    `default@example.test`
  ]);
});
