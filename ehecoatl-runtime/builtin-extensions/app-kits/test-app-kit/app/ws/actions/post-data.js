'use strict';

module.exports.index = async function index({
  services,
  wsMessageData
}) {
  const params = wsMessageData?.params ?? {};
  const mode = params?.mode ?? null;
  const payload = {
    type: `post-data`,
    actionTarget: wsMessageData?.actionTarget ?? null,
    params
  };

  if (mode === `send`) {
    await services.ws.sendMessage({
      channelId: wsMessageData?.channelId ?? null,
      clientId: wsMessageData?.clientId ?? null,
      message: payload
    });
    return null;
  }

  if (mode === `broadcast`) {
    await services.ws.broadcastMessage({
      channelId: wsMessageData?.channelId ?? null,
      message: payload
    });
    return null;
  }

  return payload;
};
