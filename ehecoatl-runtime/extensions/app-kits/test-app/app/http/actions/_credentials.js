'use strict';

const path = require(`node:path`);

async function loadCredentials(tenantRoute, services) {
  const storage = services?.storage ?? null;
  if (!storage || typeof storage.readFile !== `function`) {
    throw new Error(`Missing storage service for credentials lookup`);
  }

  const appRoot = tenantRoute?.folders?.rootFolder ?? null;
  if (!appRoot) {
    throw new Error(`Missing rootFolder for credentials lookup`);
  }

  const credentialsPath = path.join(appRoot, `.ehecoatl`, `auth`, `credentials.json`);
  const content = await storage.readFile(credentialsPath, `utf8`);
  const parsed = JSON.parse(content);
  return parsed && typeof parsed === `object` ? parsed : {};
}

module.exports = Object.freeze({
  loadCredentials
});
