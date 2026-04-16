'use strict';

const PRIVILEGED_HOST_BRIDGE_REQUEST = `privileged_host_bridge_request`;
const PRIVILEGED_HOST_BRIDGE_RESPONSE = `privileged_host_bridge_response`;
const PRIVILEGED_HOST_OPERATION_QUESTION = `privilegedHostOperation`;
const DEFAULT_BRIDGE_TIMEOUT_MS = 5_000;

async function requestPrivilegedHostOperation({
  operation,
  payload = {},
  timeoutMs = DEFAULT_BRIDGE_TIMEOUT_MS,
  processAdapter = process
} = {}) {
  const send = typeof processAdapter.send === `function` ? processAdapter.send.bind(processAdapter) : null;
  const addListener = typeof processAdapter.on === `function` ? processAdapter.on.bind(processAdapter) : null;
  const removeListener = typeof processAdapter.off === `function`
    ? processAdapter.off.bind(processAdapter)
    : typeof processAdapter.removeListener === `function`
      ? processAdapter.removeListener.bind(processAdapter)
      : null;

  if (!send || !addListener || !removeListener) {
    throw new Error(`Privileged host bridge is not available in this process.`);
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      removeListener(`message`, onMessage);
      settled = true;
    };

    const onMessage = (message) => {
      if (settled) return;
      if (!message || message?.type !== PRIVILEGED_HOST_BRIDGE_RESPONSE) return;
      if (message?.requestId !== requestId) return;
      cleanup();
      if (message?.success) {
        resolve(message.result ?? null);
        return;
      }
      const error = new Error(message?.error?.message ?? `Privileged host operation failed`);
      if (message?.error?.code) error.code = message.error.code;
      if (message?.error?.details !== undefined) error.details = message.error.details;
      reject(error);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      const error = new Error(`Privileged host operation timed out after ${timeoutMs}ms`);
      error.code = `PRIVILEGED_HOST_BRIDGE_TIMEOUT`;
      reject(error);
    }, timeoutMs);
    timer.unref?.();

    addListener(`message`, onMessage);

    try {
      send({
        type: PRIVILEGED_HOST_BRIDGE_REQUEST,
        requestId,
        operation,
        payload
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

module.exports = {
  DEFAULT_BRIDGE_TIMEOUT_MS,
  PRIVILEGED_HOST_BRIDGE_REQUEST,
  PRIVILEGED_HOST_BRIDGE_RESPONSE,
  PRIVILEGED_HOST_OPERATION_QUESTION,
  requestPrivilegedHostOperation
};

Object.freeze(module.exports);
