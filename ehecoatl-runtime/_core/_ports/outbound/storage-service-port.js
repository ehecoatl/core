// _core/_ports/outbound/services/storage-service-port.js


'use strict';


/** Contract singleton for filesystem or object-storage port operations. */
class StorageServicePort {
  /** @type {(path: string) => Promise<any[]>} */
  listEntries;
  /** @type {(filePath: string, encoding?: BufferEncoding | null) => Promise<any>} */
  readFileAdapter;
  /** @type {(filePath: string, encoding?: BufferEncoding | null) => any} */
  readFileSyncAdapter;
  /** @type {(filePath: string, data: any, encoding?: BufferEncoding) => Promise<void>} */
  writeFileAdapter;
  /** @type {(filePath: string, data: any, encoding?: BufferEncoding) => void} */
  writeFileSyncAdapter;
  /** @type {(filePath: string, line: any, encoding?: BufferEncoding) => Promise<void>} */
  appendFileAdapter;
  /** @type {(filePath: string) => Promise<import('fs').Stats>} */
  fileStatAdapter;
  /** @type {(...paths: string[]) => Promise<void>} */
  createFolderAdapter;
  /** @type {(filePath: string) => Promise<boolean>} */
  fileExistsAdapter;
  /** @type {(filePath: string) => boolean} */
  fileExistsSyncAdapter;
  /** @type {(filePath: string) => Promise<boolean>} */
  deleteFileAdapter;
  /** @type {(path: string, encoding?: any) => import('fs').ReadStream} */
  readStreamAdapter;
  /** @type {(path: string, encoding?: any) => import('fs').WriteStream} */
  writeStreamAdapter;
  /** @type {(readStream: import('fs').ReadStream, writeStream: import('fs').WriteStream) => any} */
  pipeStreamAdapter;
  /** @type {(readStream: import('fs').ReadStream, writeStream: import('fs').WriteStream, lineTransformCallback?: ((line: string) => string | Promise<string>) | null) => any} */
  pipeStreamByLineAdapter;
  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new StorageServicePort();
Object.preventExtensions(module.exports);
