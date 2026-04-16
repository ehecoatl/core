// adapters/shared/storage-service/local.js


'use strict';


const StorageServicePort = require(`@/_core/_ports/outbound/storage-service-port`);
const fs = require(`fs`);
const fsp = fs.promises;
const split2 = require(`split2`);
const { Transform, pipeline } = require(`stream`);

StorageServicePort.listEntries = async function ({ path }) {
  try {
    return await fsp.readdir(path, { withFileTypes: true });
  } catch (error) {
    console.error('Error processing folder concurrently:', error);
  }
};

StorageServicePort.readStreamAdapter = ({ path, encoding }) => {
  return fs.createReadStream(path, encoding);
};

StorageServicePort.writeStreamAdapter = ({ path, encoding }) => {
  return fs.createWriteStream(path, encoding);
};

/**
 * @param {fs.ReadStream} readStream 
 * @param {fs.WriteStream} writeStream 
 */
StorageServicePort.pipeStreamAdapter = (readStream, writeStream) => {
  return readStream.pipe(writeStream);
};

/**
 * @param {fs.ReadStream} readStream 
 * @param {fs.WriteStream} writeStream 
 * @param {(line: string)=>string} lineTransformCallback
 */
StorageServicePort.pipeStreamByLineAdapter = (readStream, writeStream, lineTransformCallback = null) => {
  const lineProcessor = new Transform({
    objectMode: true,
    async transform(line, encoding, callback) {
      if (lineTransformCallback) {
        this.push(await lineTransformCallback(line));
      } else {
        this.push(line);
      }

      callback(); // clear memory and next
    }
  });

  return pipeline(
    readStream,
    split2(),
    lineProcessor,
    writeStream,
    (err) => {
      if (err) {
        //ERROR
      } else {
        //SUCCESS
      }
    }
  );
};

StorageServicePort.createFolderAdapter = async ({ path }) => {
  const paths = Array.isArray(path) ? path : [path];
  for (let i = 0, l = paths.length; i < l; i++) {
    const exist = await StorageServicePort.fileExistsAdapter({ path: paths[i] }).catch((error) => {
      if (error?.code === `ENOENT`) return false;
      throw error;
    });
    if (!exist) { await fsp.mkdir(paths[i], { recursive: true }); }
  }
};

StorageServicePort.fileExistsAdapter = async ({ path: filePath }) => {
  await fsp.access(filePath, fs.constants.F_OK);
  return true;
};

StorageServicePort.deleteFileAdapter = async ({ path: filePath }) => {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === `ENOENT`) return false;
    throw error;
  }
};

StorageServicePort.fileStatAdapter = async ({ path: filePath }) => {
  return await fsp.stat(filePath);
};

StorageServicePort.readFileAdapter = async ({ path: filePath, encoding = null }) => {
  return await fsp.readFile(filePath, encoding);
};

StorageServicePort.writeFileAdapter = async ({ path: filePath, content: data, encoding = "utf8" }) => {
  await fsp.writeFile(filePath, data, "utf8");
};

StorageServicePort.appendFileAdapter = async ({ path: filePath, content: line, encoding = "utf8" }) => {
  await fsp.appendFile(filePath, line, "utf8");
};

module.exports = StorageServicePort;
Object.freeze(StorageServicePort);
