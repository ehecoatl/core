// adapters/inbound/ingress-runtime/uws/multipart/multipart-stream-parser.js


'use strict';


const { StringDecoder } = require("string_decoder");

module.exports = function createMultipartStreamParser(boundary) {
  const decoder = new StringDecoder("utf8");
  const delimiter = `--${boundary}`;
  const endDelimiter = `--${boundary}--`;

  let buffer = "";
  let headersParsed = false;
  let currentHeaders = {};
  let fieldName = null;
  let fileName = null;
  let collectingField = "";
  let isFile = false;

  const parser = {
    onField: null,
    onFileStart: null,
    onFileData: null,
    onFileEnd: null,

    write(chunk) {
      buffer += decoder.write(chunk);

      while (true) {
        if (!headersParsed) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;

          const rawHeaders = buffer.slice(0, headerEnd);
          buffer = buffer.slice(headerEnd + 4);

          currentHeaders = {};
          rawHeaders.split("\r\n").forEach((h) => {
            const [k, v] = h.split(":");
            if (v) currentHeaders[k.toLowerCase()] = v.trim();
          });

          const disp = currentHeaders["content-disposition"];
          if (!disp) continue;

          const nameMatch = disp.match(/name="([^"]+)"/);
          const fileMatch = disp.match(/filename="([^"]+)"/);

          fieldName = nameMatch?.[1];
          fileName = fileMatch?.[1];
          isFile = !!fileName;

          if (isFile && parser.onFileStart) {
            parser.onFileStart({ name: fieldName, filename: fileName });
          }

          collectingField = "";
          headersParsed = true;
        }

        const boundaryIndex = buffer.indexOf(`\r\n${delimiter}`);
        if (boundaryIndex === -1) {
          if (isFile && parser.onFileData) {
            parser.onFileData(Buffer.from(buffer));
            buffer = "";
          } else {
            collectingField += buffer;
            buffer = "";
          }
          return;
        }

        const part = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        if (isFile) {
          if (parser.onFileData) parser.onFileData(Buffer.from(part));
          if (parser.onFileEnd) parser.onFileEnd();
        } else {
          collectingField += part;
          if (parser.onField) parser.onField(fieldName, collectingField);
        }

        headersParsed = false;
        fieldName = null;
        fileName = null;
        isFile = false;

        if (buffer.startsWith(endDelimiter)) return;
      }
    }
  };

  return parser;
}
