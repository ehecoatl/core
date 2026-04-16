// adapters/outbound/i18n-compiler/ehecoatl-default.js


'use strict';


const I18nCompilerPort = require(`@/_core/_ports/outbound/i18n-compiler-port`);
const escapeRegex = (source) => String(source).replace(/[.*+?^${}()[\]\\]/g, `\\$&`);

function concatArray(strings, join = `,`) {
  let result = ``;
  for (let i = 0, l = strings.length; i < l; i++) {
    result += (i ? join : ``) + strings[i];
  }
  return result;
};

I18nCompilerPort.replaceOneShotAdapter = async function replaceOneShotAdapter({
  source,
  pairsMap,
  keyMask = `?`,
  replaceMask = `?`
}) {
  const compiledReplacer = await this.compileAdapter({
    pairsMap,
    keyMask,
    replaceMask
  });
  return compiledReplacer(String(source ?? ``));
};

I18nCompilerPort.compileAdapter = async function compileAdapter({
  pairsMap,
  keyMask = `?`,
  replaceMask = `?`
}) {
  if (!pairsMap || typeof pairsMap !== `object` || Array.isArray(pairsMap)) {
    return (source) => String(source ?? ``);
  }

  if (
    typeof keyMask !== `string` || keyMask.length <= 0 ||
    typeof replaceMask !== `string` || replaceMask.length <= 0
  ) {
    return (source) => String(source ?? ``);
  }

  const keys = Object.keys(pairsMap);
  if (keys.length === 0) {
    return (source) => String(source ?? ``);
  }

  const compiledMap = new Map();
  if (keyMask === `?` && replaceMask === `?`) {
    for (const key of keys) {
      compiledMap.set(key, String(pairsMap[key] ?? ``));
    }
  } else {
    for (const key of keys) {
      const token = keyMask.includes(`?`) ? keyMask.replaceAll(`?`, key) : key;
      const replacementValue = String(pairsMap[key] ?? ``);
      const replacement = replaceMask.includes(`?`)
        ? replaceMask.replaceAll(`?`, replacementValue)
        : replacementValue;
      compiledMap.set(token, replacement);
    }
  }

  const expression = new RegExp(
    concatArray(Array.from(compiledMap.keys()).map((key) => escapeRegex(key)), `|`),
    `g`
  );
  const snapshot = Object.fromEntries(compiledMap);

  return (source) => String(source ?? ``).replace(expression, (match) => snapshot[match] ?? match);
};

I18nCompilerPort.replaceAdapter = async function replaceAdapter({
  source,
  compiledReplacer
}) {
  const normalizedSource = String(source ?? ``);
  if (typeof compiledReplacer !== `function`) {
    return normalizedSource;
  }
  return compiledReplacer(normalizedSource);
};

module.exports = I18nCompilerPort;
Object.freeze(module.exports);
