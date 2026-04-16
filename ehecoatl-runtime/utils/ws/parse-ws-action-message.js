'use strict';

module.exports = {
  parseWsActionMessage
};

Object.freeze(module.exports);

function parseWsActionMessage(rawMessage, {
  wsActionsAvailable = null
} = {}) {
  if (!Array.isArray(wsActionsAvailable) || wsActionsAvailable.length === 0) {
    return createFailure(`ws_actions_unavailable`);
  }

  if (typeof rawMessage !== `string`) {
    return createFailure(`invalid_message_type`);
  }

  const normalizedMessage = rawMessage.trim();
  if (!normalizedMessage) {
    return createFailure(`invalid_message_format`);
  }

  const separatorIndex = normalizedMessage.indexOf(`?`);
  const actionTarget = separatorIndex >= 0
    ? normalizedMessage.slice(0, separatorIndex).trim()
    : normalizedMessage;
  const queryString = separatorIndex >= 0
    ? normalizedMessage.slice(separatorIndex + 1)
    : ``;

  if (!actionTarget) {
    return createFailure(`invalid_message_format`);
  }
  if (!wsActionsAvailable.includes(actionTarget)) {
    return createFailure(`unsupported_action`, {
      actionTarget
    });
  }

  let params = null;
  try {
    params = parseQueryString(queryString);
  } catch (error) {
    return createFailure(`invalid_query_encoding`, {
      actionTarget,
      error: error?.message ?? String(error)
    });
  }

  return Object.freeze({
    success: true,
    raw: normalizedMessage,
    actionTarget,
    queryString,
    params
  });
}

function parseQueryString(queryString = ``) {
  const normalized = typeof queryString === `string`
    ? queryString
    : String(queryString ?? ``);
  if (!normalized) return Object.freeze({});

  const parsed = {};
  for (const entry of normalized.split(`&`)) {
    if (!entry) continue;
    const separatorIndex = entry.indexOf(`=`);
    const rawKey = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;
    const rawValue = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : ``;
    const key = decodeQueryComponent(rawKey);
    const value = decodeQueryComponent(rawValue);

    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const current = parsed[key];
      parsed[key] = Array.isArray(current)
        ? [...current, value]
        : [current, value];
      continue;
    }

    parsed[key] = value;
  }

  return Object.freeze(parsed);
}

function decodeQueryComponent(value) {
  return decodeURIComponent(String(value ?? ``).replace(/\+/g, ` `));
}

function createFailure(reason, extra = {}) {
  return Object.freeze({
    success: false,
    reason,
    ...extra
  });
}
