// _core/services/storage-service/storage-service.js


'use strict';

const AdaptableUseCase = require(`@/_core/_ports/adaptable-use-case`);

/** Shared service use case that wraps storage port operations with plugin hook instrumentation. */
class StorageService extends AdaptableUseCase {
  /** @type {typeof import('@/config/default.config').adapters.storageService} */
  config;
  /** @type {import('@/_core/orchestrators/plugin-orchestrator')} */
  plugin;
  storageHooks;
  /** @type {import('@/_core/_ports/outbound/services/storage-service-port')} */
  adapter = null;

  /** Captures storage config, hook references, and lazy adapter metadata for shared storage access. */
  constructor(kernelContext) {
    super(kernelContext.config._adapters.storageService);
    this.config = kernelContext.config.adapters.storageService;
    this.plugin = kernelContext.pluginOrchestrator;
    this.storageHooks = this.plugin.hooks.SHARED.STORAGE;
    super.loadAdapter();

    Object.freeze(this);
  }

  /** Lists entries for one storage path through the active adapter. */
  async listEntries(path) {
    return this.#wrapAdapterCall(
      `listEntries`,
      { operation: `listEntries`, path },
      { path }
    );
  }

  /** Opens a readable storage stream for one path and encoding. */
  async readStream(path, encoding) {
    return this.#wrapAdapterCall(
      `readStreamAdapter`,
      { operation: `readStream`, path, encoding },
      { path, encoding }
    );
  }

  /** Opens a writable storage stream for one path and encoding. */
  async writeStream(path, encoding) {
    return this.#wrapAdapterCall(
      `writeStreamAdapter`,
      { operation: `writeStream`, path, encoding },
      { path, encoding }
    );
  }

  /** Pipes one stream into another using the active storage backend. */
  async pipeStream(readStream, writeStream) {
    return this.#wrapAdapterCall(
      `pipeStreamAdapter`,
      { operation: `pipeStream`, readStream, writeStream },
      { readStream, writeStream }
    );
  }

  /** Pipes a stream line-by-line with an optional transform callback. */
  async pipeStreamByLine(
    readStream,
    writeStream,
    lineTransformCallback = null
  ) {
    return this.#wrapAdapterCall(
      `pipeStreamByLineAdapter`,
      { operation: `pipeStreamByLine`, readStream, writeStream, lineTransformCallback },
      { readStream, writeStream, lineTransformCallback }
    );
  }

  /** Creates a folder path in the current storage backend. */
  async createFolder(path) {
    return this.#wrapAdapterCall(
      `createFolderAdapter`,
      { operation: `createFolder`, path },
      { path }
    );
  }

  /** Reads a full file from storage using the provided encoding. */
  async readFile(path, encoding) {
    return this.#wrapAdapterCall(
      `readFileAdapter`,
      { operation: `readFile`, path, encoding },
      { path, encoding }
    );
  }

  /** Writes a full file to storage using the provided encoding. */
  async writeFile(path, content, encoding) {
    return this.#wrapAdapterCall(
      `writeFileAdapter`,
      { operation: `writeFile`, path, content, encoding },
      { path, content, encoding }
    );
  }

  /** Appends content to an existing file in storage. */
  async appendToFile(path, content, encoding) {
    return this.#wrapAdapterCall(
      `appendFileAdapter`,
      { operation: `appendToFile`, path, content, encoding },
      { path, content, encoding }
    );
  }

  /** Reads file metadata from the active storage backend. */
  async fileStat(path) {
    return this.#wrapAdapterCall(
      `fileStatAdapter`,
      { operation: `fileStat`, path },
      { path }
    );
  }

  /** Checks whether a path exists in the active storage backend. */
  async fileExists(path) {
    return this.#wrapAdapterCall(
      `fileExistsAdapter`,
      { operation: `fileExists`, path },
      { path }
    );
  }

  /** Deletes one file path from the active storage backend. */
  async deleteFile(path) {
    return this.#wrapAdapterCall(
      `deleteFileAdapter`,
      { operation: `deleteFile`, path },
      { path }
    );
  }

  /** Wraps one storage adapter call with before/after/error plugin hook dispatch. */
  async #wrapAdapterCall(methodName, payload, params) {
    const plugin = this.plugin;
    const { BEFORE, AFTER, ERROR } = this.storageHooks;
    super.loadAdapter();
    const adapterMethod = this.adapter?.[methodName] ?? null;

    await plugin.run(BEFORE, payload, ERROR);
    try {
      const result = await adapterMethod(params);
      await plugin.run(AFTER, { ...payload, result }, ERROR);
      return result;
    } catch (error) {
      await plugin.run(ERROR, { ...payload, error });
      throw error;
    }
  }
}

module.exports = StorageService;
Object.freeze(module.exports);
