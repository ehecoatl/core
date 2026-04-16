#!/usr/bin/env node

import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

function main() {
  const options = parseArgs(process.argv.slice(2));
  runProbe(options)
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.exit(0);
    })
    .catch((error) => {
      const summary = error?.summary ?? {
        success: false,
        error: error?.message ?? String(error)
      };
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.exit(1);
    });
}

async function runProbe(options) {
  const targetUrl = new URL(options.url);
  const isSecure = targetUrl.protocol === 'wss:';
  if (![`ws:`, `wss:`].includes(targetUrl.protocol)) {
    throw createFailure(`Unsupported protocol ${targetUrl.protocol}`, {
      url: options.url
    });
  }

  const port = Number(targetUrl.port || (isSecure ? 443 : 80));
  const hostHeader = buildHostHeader(targetUrl, port, isSecure);
  const pathWithQuery = `${targetUrl.pathname || `/`}${targetUrl.search || ``}`;
  const secWebSocketKey = crypto.randomBytes(16).toString(`base64`);
  const socket = isSecure
    ? tls.connect({
      host: targetUrl.hostname,
      port,
      servername: targetUrl.hostname,
      rejectUnauthorized: false
    })
    : net.createConnection({
      host: targetUrl.hostname,
      port
    });

  const expectedJson = options.expectJson.map(parseExpectation);
  const receivedMessages = [];

  return await new Promise((resolve, reject) => {
    let finished = false;
    let handshakeDone = false;
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let matchedMessage = null;

    const timeout = setTimeout(() => {
      finalizeFailure(`Probe timed out`, {
        status: handshakeDone ? 101 : null,
        receivedMessages
      });
    }, options.timeoutMs);

    socket.on(`error`, (error) => {
      finalizeFailure(`Socket error: ${error.message}`, {
        status: handshakeDone ? 101 : null,
        receivedMessages
      });
    });

    socket.on(`close`, () => {
      if (!finished && !isSatisfied()) {
        finalizeFailure(`Socket closed before expectations were satisfied`, {
          status: handshakeDone ? 101 : null,
          receivedMessages
        });
      }
    });

    socket.on(`connect`, () => {
      socket.write(buildHandshakeRequest({
        pathWithQuery,
        hostHeader,
        secWebSocketKey,
        cookie: options.cookie
      }));
    });

    socket.on(`secureConnect`, () => {
      socket.write(buildHandshakeRequest({
        pathWithQuery,
        hostHeader,
        secWebSocketKey,
        cookie: options.cookie
      }));
    });

    socket.on(`data`, (chunk) => {
      if (!handshakeDone) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEndIndex = handshakeBuffer.indexOf(`\r\n\r\n`);
        if (headerEndIndex === -1) {
          return;
        }

        const headerBuffer = handshakeBuffer.subarray(0, headerEndIndex);
        const remainder = handshakeBuffer.subarray(headerEndIndex + 4);
        handshakeBuffer = Buffer.alloc(0);
        const response = parseHandshakeResponse(headerBuffer.toString(`utf8`));

        if (response.status !== options.expectStatus) {
          finalizeFailure(`Unexpected handshake status`, {
            status: response.status,
            headers: response.headers
          });
          return;
        }

        if (response.status !== 101) {
          finalizeSuccess({
            success: true,
            url: options.url,
            status: response.status,
            headers: response.headers,
            receivedMessages: []
          });
          return;
        }

        validateAcceptHeader(response.headers, secWebSocketKey);
        handshakeDone = true;
        frameBuffer = remainder;

        if (options.send) {
          socket.write(encodeClientTextFrame(options.send));
        }

        if (isSatisfied()) {
          finalizeSuccess({
            success: true,
            url: options.url,
            status: 101,
            matchedMessage,
            receivedMessages
          });
          return;
        }

        consumeFrames();
        return;
      }

      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      consumeFrames();
    });

    function consumeFrames() {
      while (true) {
        const frame = decodeServerFrame(frameBuffer);
        if (!frame) return;
        frameBuffer = frameBuffer.subarray(frame.bytesConsumed);

        if (frame.opcode === 0x8) {
          socket.end();
          if (!isSatisfied()) {
            finalizeFailure(`Socket received close frame before expectations were satisfied`, {
              status: 101,
              receivedMessages
            });
          }
          return;
        }

        if (frame.opcode === 0x9) {
          socket.write(encodeClientControlFrame(0xA, frame.payload));
          continue;
        }

        if (frame.opcode !== 0x1) {
          continue;
        }

        const text = frame.payload.toString(`utf8`);
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}

        const message = {
          text,
          json
        };
        receivedMessages.push(message);

        if (matchesExpectations(message)) {
          matchedMessage = message;
          finalizeSuccess({
            success: true,
            url: options.url,
            status: 101,
            matchedMessage,
            receivedMessages
          });
          return;
        }

        if (receivedMessages.length >= options.maxMessages && !isSatisfied()) {
          finalizeFailure(`Maximum message limit reached without satisfying expectations`, {
            status: 101,
            receivedMessages
          });
          return;
        }
      }
    }

    function matchesExpectations(message) {
      if (options.expectText.length > 0) {
        for (const expectedText of options.expectText) {
          if (!message.text.includes(expectedText)) {
            return false;
          }
        }
      }

      if (expectedJson.length > 0) {
        if (!message.json || typeof message.json !== `object`) {
          return false;
        }
        for (const expectation of expectedJson) {
          const actual = getPathValue(message.json, expectation.path);
          if (!isEqualExpectation(actual, expectation.value)) {
            return false;
          }
        }
      }

      if (options.expectText.length === 0 && expectedJson.length === 0) {
        return true;
      }

      return true;
    }

    function isSatisfied() {
      return options.expectStatus !== 101 || (options.expectText.length === 0 && expectedJson.length === 0);
    }

    function finalizeSuccess(summary) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.end();
      resolve(summary);
    }

    function finalizeFailure(message, extra = {}) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(createFailure(message, {
        success: false,
        url: options.url,
        ...extra
      }));
    }
  });
}

function buildHandshakeRequest({
  pathWithQuery,
  hostHeader,
  secWebSocketKey,
  cookie = ``
}) {
  const headers = [
    `GET ${pathWithQuery} HTTP/1.1`,
    `Host: ${hostHeader}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Version: 13`,
    `Sec-WebSocket-Key: ${secWebSocketKey}`
  ];

  if (cookie) {
    headers.push(`Cookie: ${cookie}`);
  }

  headers.push(``, ``);
  return headers.join(`\r\n`);
}

function buildHostHeader(targetUrl, port, isSecure) {
  const defaultPort = isSecure ? 443 : 80;
  if (!targetUrl.port || Number(port) === defaultPort) {
    return targetUrl.hostname;
  }
  return `${targetUrl.hostname}:${port}`;
}

function parseHandshakeResponse(rawHeaders) {
  const lines = rawHeaders.split(`\r\n`);
  const statusLine = lines.shift() ?? ``;
  const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/i);
  if (!match) {
    throw createFailure(`Invalid handshake response`, {
      rawHeaders
    });
  }

  const headers = {};
  for (const line of lines) {
    if (!line) continue;
    const separatorIndex = line.indexOf(`:`);
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }

  return {
    status: Number(match[1]),
    headers
  };
}

function validateAcceptHeader(headers, secWebSocketKey) {
  const expectedAccept = crypto
    .createHash(`sha1`)
    .update(`${secWebSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, `utf8`)
    .digest(`base64`);
  const actualAccept = headers[`sec-websocket-accept`];
  if (actualAccept !== expectedAccept) {
    throw createFailure(`Invalid Sec-WebSocket-Accept header`, {
      expectedAccept,
      actualAccept
    });
  }
}

function encodeClientTextFrame(text) {
  return encodeClientControlFrame(0x1, Buffer.from(text, `utf8`));
}

function encodeClientControlFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const payloadLength = payload.length;
  let header = null;

  if (payloadLength < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payloadLength]);
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  const maskedPayload = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4];
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

function decodeServerFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = Boolean(firstByte & 0x80);
  const opcode = firstByte & 0x0f;
  const masked = Boolean(secondByte & 0x80);
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (!fin) {
    throw createFailure(`Fragmented frames are not supported by this probe`);
  }

  if (masked) {
    throw createFailure(`Server frames must not be masked`);
  }

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  if (!Number.isFinite(payloadLength) || payloadLength < 0) {
    throw createFailure(`Invalid payload length`);
  }

  if (buffer.length < offset + payloadLength) return null;

  const payload = buffer.subarray(offset, offset + payloadLength);
  return {
    opcode,
    payload,
    bytesConsumed: offset + payloadLength
  };
}

function getPathValue(object, path) {
  let current = object;
  for (const part of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function parseExpectation(raw) {
  const separatorIndex = raw.indexOf(`=`);
  if (separatorIndex === -1) {
    throw createFailure(`Expectation must use path=value syntax`, {
      raw
    });
  }
  const path = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1);
  if (!path) {
    throw createFailure(`Expectation path cannot be empty`, {
      raw
    });
  }
  return {
    path: path.split(`.`),
    value: parseLiteral(value)
  };
}

function parseLiteral(value) {
  if (value === `true`) return true;
  if (value === `false`) return false;
  if (value === `null`) return null;
  if (value === `undefined`) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function isEqualExpectation(actual, expected) {
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.includes(expected);
  }
  return Object.is(actual, expected);
}

function parseArgs(argv) {
  const options = {
    url: null,
    cookie: ``,
    send: ``,
    timeoutMs: 5000,
    maxMessages: 10,
    expectStatus: 101,
    expectText: [],
    expectJson: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case `--url`:
        options.url = argv[++index] ?? null;
        break;
      case `--cookie`:
        options.cookie = argv[++index] ?? ``;
        break;
      case `--send`:
        options.send = argv[++index] ?? ``;
        break;
      case `--timeout-ms`:
        options.timeoutMs = Number(argv[++index] ?? 5000);
        break;
      case `--max-messages`:
        options.maxMessages = Number(argv[++index] ?? 10);
        break;
      case `--expect-status`:
        options.expectStatus = Number(argv[++index] ?? 101);
        break;
      case `--expect-text`:
        options.expectText.push(argv[++index] ?? ``);
        break;
      case `--expect-json`:
        options.expectJson.push(argv[++index] ?? ``);
        break;
      case `--help`:
        printHelp();
        process.exit(0);
      default:
        throw createFailure(`Unknown argument ${arg}`);
    }
  }

  if (!options.url) {
    throw createFailure(`Missing required --url argument`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw createFailure(`--timeout-ms must be a positive number`);
  }

  if (!Number.isFinite(options.maxMessages) || options.maxMessages <= 0) {
    throw createFailure(`--max-messages must be a positive number`);
  }

  if (!Number.isFinite(options.expectStatus) || options.expectStatus < 100) {
    throw createFailure(`--expect-status must be a valid HTTP status code`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      `Usage: node ws-probe.mjs --url <ws://...> [options]`,
      ``,
      `Options:`,
      `  --cookie <cookie-header>      Cookie header value to send during upgrade`,
      `  --send <text>                 Send one text message after a successful 101 upgrade`,
      `  --expect-status <code>        Expected handshake status (default: 101)`,
      `  --expect-text <substring>     Require a received text frame to include the substring`,
      `  --expect-json <path=value>    Require a received JSON frame to match a dotted path`,
      `  --timeout-ms <ms>             Timeout for the whole probe (default: 5000)`,
      `  --max-messages <n>            Maximum received messages before failure (default: 10)`,
      `  --help                        Show this help`
    ].join(`\n`) + `\n`
  );
}

function createFailure(message, extra = {}) {
  const error = new Error(message);
  error.summary = {
    success: false,
    error: message,
    ...extra
  };
  return error;
}

main();
