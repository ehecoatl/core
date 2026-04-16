// _core/_ports/outbound/i18n-compiler-port.js


'use strict';


/** Contract singleton for i18n token compilation and replacement adapters. */
class I18nCompilerPort {
  /**
   * @type {(params: {
   * source: string,
   * pairsMap?: Record<string, string> | null,
   * keyMask?: string,
   * replaceMask?: string
   * }) => Promise<string>}
   */
  replaceOneShotAdapter;

  /**
   * @type {(params: {
   * pairsMap?: Record<string, string> | null,
   * keyMask?: string,
   * replaceMask?: string
   * }) => Promise<(source: string) => string>}
   */
  compileAdapter;

  /**
   * @type {(params: {
   * source: string,
   * compiledReplacer: ((source: string) => string) | null
   * }) => Promise<string>}
   */
  replaceAdapter;

  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new I18nCompilerPort();
Object.preventExtensions(module.exports);
