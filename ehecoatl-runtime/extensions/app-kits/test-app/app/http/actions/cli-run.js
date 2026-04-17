'use strict';

module.exports = {
  async index({ requestData, services }) {
    const commandLine = String(requestData?.body?.commandLine ?? ``).trim();
    const timeoutMs = requestData?.body?.timeoutMs ?? null;

    return {
      status: 200,
      body: await services.rpc.ask({
        target: `main`,
        question: {
          type: `cli.command.run`,
          payload: {
            commandLine,
            timeoutMs
          }
        }
      })
    };
  }
};

Object.freeze(module.exports);
