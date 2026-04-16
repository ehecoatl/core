// adapters/shared/storage-service/local.js


'use strict';


const StorageServiceAdapter = require(`g@/shared/storage-service/storage-service-adapter`);
const fs = require(`fs`);
const fsp = fs.promises;
const split2 = require(`split2`);
const { Transform, pipeline } = require(`stream`);

StorageServiceAdapter.listEntries = async function ({ path }) {
  try {
    return await fsp.readdir(path, { withFileTypes: true });
  } catch (error) {
    console.error('Error processing folder concurrently:', error);
  }
};

StorageServiceAdapter.readStreamAdapter = ({ path, encoding }) => {
  return fs.createReadStream(path, encoding);
};

StorageServiceAdapter.writeStreamAdapter = ({ path, encoding }) => {
  return fs.createWriteStream(path, encoding);
};

/**
 * @param {fs.ReadStream} readStream 
 * @param {fs.WriteStream} writeStream 
 */
StorageServiceAdapter.pipeStreamAdapter = (readStream, writeStream) => {
  return readStream.pipe(writeStream);
};

/**
 * @param {fs.ReadStream} readStream 
 * @param {fs.WriteStream} writeStream 
 * @param {(line: string)=>string} lineTransformCallback
 */
StorageServiceAdapter.pipeStreamByLineAdapter = (readStream, writeStream, lineTransformCallback = null) => {
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

StorageServiceAdapter.createFolderAdapter = async ({ path }) => {
  const paths = Array.isArray(path) ? path : [path];
  for (let i = 0, l = paths.length; i < l; i++) {
    const exist = await StorageServiceAdapter.fileExistsAdapter(paths[i]);
    if (!exist) { await fsp.mkdir(paths[i], { recursive: true }); }
  }
};

StorageServiceAdapter.fileExistsAdapter = async ({ path: filePath }) => {
  await fsp.access(filePath, fs.constants.F_OK);
  return true;
};

StorageServiceAdapter.deleteFileAdapter = async ({ path: filePath }) => {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === `ENOENT`) return false;
    throw error;
  }
};

StorageServiceAdapter.fileStatAdapter = async ({ path: filePath }) => {
  return await fsp.stat(filePath);
};

StorageServiceAdapter.readFileAdapter = async ({ path: filePath, encoding = null }) => {
  return await fsp.readFile(filePath, encoding);
};

StorageServiceAdapter.writeFileAdapter = async ({ path: filePath, content: data, encoding = "utf8" }) => {
  await fsp.writeFile(filePath, data, "utf8");
};

StorageServiceAdapter.appendFileAdapter = async ({ path: filePath, content: line, encoding = "utf8" }) => {
  await fsp.appendFile(filePath, line, "utf8");
};

module.exports = StorageServiceAdapter;
Object.freeze(StorageServiceAdapter);
