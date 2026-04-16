'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const os = require(`node:os`);
const path = require(`node:path`);

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

test(`AdaptableUseCase eagerly loads a valid adapter during construction`, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ehecoatl-adaptable-use-case-`));
  const adapterPath = path.join(tempRoot, `mock-adapter.js`);
  fs.writeFileSync(adapterPath, [
    `'use strict';`,
    `module.exports = Object.freeze({`,
    `  marker: 'loaded-eagerly'`,
    `});`
  ].join(`\n`), `utf8`);

  const useCase = new AdaptableUseCase(adapterPath);

  assert.equal(useCase.adapterPath, adapterPath);
  assert.deepEqual(useCase.adapter, { marker: `loaded-eagerly` });
  assert.equal(useCase.loadAdapter(), useCase.adapter);
});

test(`AdaptableUseCase throws during construction when the adapter path is invalid`, () => {
  const missingAdapterPath = path.join(
    os.tmpdir(),
    `ehecoatl-adaptable-use-case-missing-${Date.now()}-${Math.random().toString(36).slice(2)}.js`
  );

  assert.throws(
    () => new AdaptableUseCase(missingAdapterPath),
    /Cannot find module/
  );
});
