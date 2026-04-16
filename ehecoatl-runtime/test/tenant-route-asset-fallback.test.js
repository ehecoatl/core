'use strict';

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);
const Module = require(`node:module`);

installLocalAliasResolver();

const TenantRoute = require(`../_core/runtimes/ingress-runtime/execution/tenant-route`);

test(`TenantRoute.assetPath uses the app asset when it exists`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-route-assets-`));
  const appAssetsRoot = path.join(tempRoot, `app-assets`);
  const sharedAssetsRoot = path.join(tempRoot, `shared-assets`);
  fs.mkdirSync(path.join(appAssetsRoot, `static`, `htm`), { recursive: true });
  fs.mkdirSync(path.join(sharedAssetsRoot, `static`, `htm`), { recursive: true });
  fs.writeFileSync(path.join(appAssetsRoot, `static`, `htm`, `index.htm`), `app`, `utf8`);
  fs.writeFileSync(path.join(sharedAssetsRoot, `static`, `htm`, `index.htm`), `shared`, `utf8`);

  try {
    const route = new TenantRoute({
      pointsTo: `asset > static/htm/index.htm`,
      folders: {
        assetsRootFolder: appAssetsRoot,
        assetsSharedRootFolder: sharedAssetsRoot
      }
    });

    assert.equal(
      route.assetPath(),
      path.join(appAssetsRoot, `static`, `htm`, `index.htm`)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`TenantRoute.assetPath falls back to tenant shared assets when the app asset is missing`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-route-assets-shared-`));
  const appAssetsRoot = path.join(tempRoot, `app-assets`);
  const sharedAssetsRoot = path.join(tempRoot, `shared-assets`);
  fs.mkdirSync(path.join(appAssetsRoot, `static`, `htm`), { recursive: true });
  fs.mkdirSync(path.join(sharedAssetsRoot, `static`, `htm`), { recursive: true });
  fs.writeFileSync(path.join(sharedAssetsRoot, `static`, `htm`, `index.htm`), `shared`, `utf8`);

  try {
    const route = new TenantRoute({
      pointsTo: `asset > static/htm/index.htm`,
      folders: {
        assetsRootFolder: appAssetsRoot,
        assetsSharedRootFolder: sharedAssetsRoot
      }
    });

    assert.equal(
      route.assetPath(),
      path.join(sharedAssetsRoot, `static`, `htm`, `index.htm`)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test(`TenantRoute.assetPath returns the app-local missing path when neither scope contains the asset`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-tenant-route-assets-missing-`));
  const appAssetsRoot = path.join(tempRoot, `app-assets`);
  const sharedAssetsRoot = path.join(tempRoot, `shared-assets`);
  fs.mkdirSync(appAssetsRoot, { recursive: true });
  fs.mkdirSync(sharedAssetsRoot, { recursive: true });

  try {
    const route = new TenantRoute({
      pointsTo: `asset > static/htm/index.htm`,
      folders: {
        assetsRootFolder: appAssetsRoot,
        assetsSharedRootFolder: sharedAssetsRoot
      }
    });

    assert.equal(
      route.assetPath(),
      path.join(appAssetsRoot, `static`, `htm`, `index.htm`)
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function installLocalAliasResolver() {
  if (global.__EHECOATL_LOCAL_ALIAS_RESOLVER__) return;
  global.__EHECOATL_LOCAL_ALIAS_RESOLVER__ = true;

  const projectRoot = path.resolve(__dirname, `..`);
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function patchedResolveFilename(request, parent, ...rest) {
    if (typeof request === `string` && request.startsWith(`@/`)) {
      request = path.join(projectRoot, request.slice(2));
    } else if (typeof request === `string` && request.startsWith(`@middleware/`)) {
      request = path.join(projectRoot, `extensions`, `middlewares`, request.slice(`@middleware/`.length));
    }
    return originalResolveFilename.call(this, request, parent, ...rest);
  };
}
