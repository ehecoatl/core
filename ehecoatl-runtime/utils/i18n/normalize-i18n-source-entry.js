'use strict';

const path = require(`node:path`);

const I18N_PREFIX = `assets/i18n/`;

module.exports = function normalizeI18nSourceEntry(entry, {
  entryLabel = `i18n path`
} = {}) {
  const normalizedEntry = String(entry ?? ``).trim();
  if (!normalizedEntry) {
    throw new Error(`${entryLabel} must be a non-empty relative path`);
  }
  if (path.isAbsolute(normalizedEntry)) {
    throw new Error(`${entryLabel} must be a non-empty relative path`);
  }

  return normalizedEntry.startsWith(I18N_PREFIX)
    ? normalizedEntry
    : `${I18N_PREFIX}${normalizedEntry}`;
};

module.exports.I18N_PREFIX = I18N_PREFIX;
Object.freeze(module.exports);
