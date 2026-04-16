// adapters/inbound/ingress-runtime/uws/uws-http-write-response.js


'use strict';


const cookieSerialize = require(`@/utils/cookie/cookie-serialize`);
const {
  corkIfAvailable,
  writeUwsResponseHead
} = require(`@/utils/http/http-response-write`);

/** @param {import('@/_core/runtimes/ingress-runtime/execution/execution-context')} executionContext  */
module.exports = async function writeHttpResponse(executionContext) {
  const responseWriteStartedAt = Date.now();
  const { run, hooks } = executionContext;
  const {
    responseData,
    res
  } = executionContext;

  const {
    headers = {},
    cookie = null,
    status = 200,
    body = ``
  } = responseData;

  await run(hooks.RESPONSE.WRITE.START);
  try {
    const responseHeaders = { ...(headers ?? {}) };
    stripHeader(responseHeaders, `x-accel-redirect`);
    const requestId = executionContext.meta?.requestId ?? executionContext.requestData?.requestId ?? null;
    if (requestId && !hasHeader(responseHeaders, `x-request-id`)) {
      responseHeaders[`X-Request-Id`] = String(requestId);
    }

    if (cookie && Object.keys(cookie).length > 0) {
      appendHeader(responseHeaders, `set-cookie`, cookieSerialize(cookie));
    }

    // STREAMS need the response head sent first, then chunks are written as they arrive.
    if (body && typeof body.pipe === `function`) {
      corkIfAvailable(res, () => writeUwsResponseHead(res, {
        status,
        headers: responseHeaders
      }));
      streamBody(res, body, executionContext);
      return;
    }

    if (isStorageStreamInstruction(body)) {
      const readStream = await executionContext.services.storage.readStream(body.path);
      corkIfAvailable(res, () => writeUwsResponseHead(res, {
        status,
        headers: responseHeaders
      }));
      streamBody(res, readStream, executionContext);
      return;
    }

    if (isNginxInternalRedirectInstruction(body)) {
      responseHeaders[`X-Accel-Redirect`] = body.uri;
      corkIfAvailable(res, () => {
        writeUwsResponseHead(res, {
          status,
          headers: responseHeaders
        });
        res.end();
      });
      return;
    }

    if (body && typeof body === `object` && !Buffer.isBuffer(body)) {
      if (!hasHeader(responseHeaders, `Content-Type`)) {
        responseHeaders[`Content-Type`] = `application/json`;
      }
    }

    corkIfAvailable(res, () => {
      writeUwsResponseHead(res, {
        status,
        headers: responseHeaders
      });

      if (Buffer.isBuffer(body)) {
        res.end(body);
        return;
      }

      if (body && typeof body === `object`) {
        res.end(JSON.stringify(body));
        return;
      }

      if (typeof body === `string`) {
        res.end(body);
        return;
      }

      if (body == null) {
        res.end();
        return;
      }

      res.end(String(body));
    });
  } catch (error) {
    await run(hooks.RESPONSE.WRITE.ERROR);
    throw error;
  } finally {
    if (executionContext.meta) {
      executionContext.meta.responseWriteMs = Date.now() - responseWriteStartedAt;
    }
    if (executionContext.isAborted()) {
      await run(hooks.RESPONSE.WRITE.BREAK);
    }
    await run(hooks.RESPONSE.WRITE.END);
  }
}

function streamBody(res, readStream, executionContext) {
  let paused = false;

  res.onWritable(() => {
    if (paused) { paused = false; readStream.resume(); }
    return !executionContext.isAborted();
  });

  readStream.on("data", (chunk) => {
    if (executionContext.isAborted()) {
      readStream.destroy?.();
      return;
    }
    let ok = true;
    corkIfAvailable(res, () => {
      ok = res.write(chunk);
    });
    if (!ok) { paused = true; readStream.pause(); }
  });
  readStream.on("end", () => {
    if (!executionContext.isAborted()) {
      corkIfAvailable(res, () => {
        res.end();
      });
    }
  });
  readStream.on("error", () => {
    if (!executionContext.isAborted()) {
      corkIfAvailable(res, () => {
        res.end();
      });
    }
  });
}

function isStorageStreamInstruction(body) {
  return Boolean(
    body
    && typeof body === `object`
    && body.__ehecoatlBodyKind === `storage-stream`
    && typeof body.path === `string`
  );
}

function isNginxInternalRedirectInstruction(body) {
  return Boolean(
    body
    && typeof body === `object`
    && body.__ehecoatlBodyKind === `nginx-internal-redirect`
    && typeof body.uri === `string`
  );
}

function hasHeader(headers, key) {
  const normalizedKey = String(key).toLowerCase();
  return Object.keys(headers ?? {})
    .some((headerName) => headerName.toLowerCase() === normalizedKey);
}

function appendHeader(headers, key, value) {
  const existingKey = Object.keys(headers)
    .find((headerName) => headerName.toLowerCase() === String(key).toLowerCase());
  const headerKey = existingKey ?? key;
  const currentValue = headers[headerKey];

  if (currentValue == null) {
    headers[headerKey] = value;
    return;
  }

  if (Array.isArray(currentValue)) {
    headers[headerKey] = [...currentValue, value];
    return;
  }

  headers[headerKey] = [currentValue, value];
}

function stripHeader(headers, key) {
  const normalizedKey = String(key).toLowerCase();
  for (const headerName of Object.keys(headers ?? {})) {
    if (headerName.toLowerCase() === normalizedKey) {
      delete headers[headerName];
    }
  }
}
