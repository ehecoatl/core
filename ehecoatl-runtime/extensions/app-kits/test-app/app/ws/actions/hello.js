'use strict';

module.exports.index = async function index({
  sessionData,
  wsMessageData
}) {
  return {
    type: `hello`,
    actionTarget: wsMessageData?.actionTarget ?? null,
    params: wsMessageData?.params ?? {},
    channelId: wsMessageData?.channelId ?? null,
    clientId: wsMessageData?.clientId ?? null,
    username: sessionData?.auth?.username ?? null
  };
};
