'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);

const tenantRoutesFindMatch = require(`@/utils/tenancy/tenant-routes-find-match`);

test(`tenant-routes-find-match returns normalized params for dynamic routes and preserves legacy substitutions`, () => {
  const match = tenantRoutesFindMatch(`/blog/post-1`, [{
    type: 1,
    regexp: /^\/blog\/([^/]+)$/,
    keys: [`slug`],
    route_data: {
      pointsTo: `run > blog@show`,
      target: {
        type: `asset`,
        value: `blog/{slug}.e.html`,
        asset: {
          path: `blog/{slug}.e.html`
        }
      }
    }
  }]);

  assert.deepEqual(match?.params, { slug: `post-1` });
  assert.equal(match?.target?.asset?.path, `blog/post-1.e.html`);
});

test(`tenant-routes-find-match preserves legacy substitutions when compiled keys include braces`, () => {
  const match = tenantRoutesFindMatch(`/en/0.1.0-beta`, [{
    type: 1,
    regexp: /^\/([^/]+)\/([^/]+)$/,
    keys: [`{lang}`, `{version}`],
    route_data: {
      pointsTo: `asset > templates/ehecoatl-{version}.e.htm`,
      target: {
        type: `asset`,
        value: `templates/ehecoatl-{version}.e.htm`,
        asset: {
          path: `templates/ehecoatl-{version}.e.htm`
        }
      },
      i18n: [
        `assets/i18n/{version}/en.json`,
        `assets/i18n/{version}/{lang}.json`
      ]
    }
  }]);

  assert.deepEqual(match?.params, {
    lang: `en`,
    version: `0.1.0-beta`
  });
  assert.equal(match?.target?.asset?.path, `templates/ehecoatl-0.1.0-beta.e.htm`);
  assert.deepEqual(match?.i18n, [
    `assets/i18n/0.1.0-beta/en.json`,
    `assets/i18n/0.1.0-beta/en.json`
  ]);
});

test(`tenant-routes-find-match keeps static routes compatible`, () => {
  const match = tenantRoutesFindMatch(`/`, [{
    type: 0,
    pattern: `/`,
    route_data: {
      pointsTo: `run > home@index`
    }
  }]);

  assert.deepEqual(match, {
    pointsTo: `run > home@index`
  });
});
