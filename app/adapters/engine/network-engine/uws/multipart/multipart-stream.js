// adapters/engine/network-engine/uws/multipart/multipart-stream.js


'use strict';


const createMultipartStreamParser = require(`./multipart-stream-parser`);
const path = require(`path`);
const fs = require(`fs`);

module.exports = function multipartStream(contentType, uploadPath, requestFlowData) {
  const boundary = contentType.split("boundary=")[1];
  const parser = createMultipartStreamParser(boundary);

  requestFlowData.body = { fields: {}, files: [] };

  parser.onField = (name, value) => {
    requestFlowData.body.fields[name] = value;
  };

  parser.onFileStart = ({ name, filename }) => {
    const file = `${Date.now()}_${filename}`;
    const filepath = path.join(uploadPath, file);
    const ws = fs.createWriteStream(filepath);

    parser.currentFile = ws;
    parser.currentFilePath = filepath;
    parser.currentFileField = name;
  };

  parser.onFileData = (chunk) => {
    parser.currentFile.write(chunk);
  };

  parser.onFileEnd = () => {
    parser.currentFile.end();

    requestFlowData.body.files.push({
      field: parser.currentFileField,
      path: parser.currentFilePath
    });
  };

  return parser;
}
