// _core/_ports/inbound/e-renderer-runtime-port.js


'use strict';


/** Contract singleton for e-renderer streaming template adapters. */
class ERendererRuntimePort {
  /**
   * @type {(params: {
   * config?: object,
   * template: string
   * }) => Promise<import('node:stream').Readable>}
   */
  streamRenderingAdapter;

  /**
   * @type {(params: {
   * config?: object,
   * source: string
   * }) => Promise<object[]>}
   */
  parseTemplateAdapter;

  /**
   * @type {(params: {
   * config?: object,
   * snippet: object,
   * context: object
   * }) => Promise<import('node:stream').Readable>}
   */
  processSnippetAdapter;

  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new ERendererRuntimePort();
Object.preventExtensions(module.exports);
