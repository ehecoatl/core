'use strict';

module.exports = {
  index({ requestData }) {
    return {
      status: 200,
      headers: {
        'Cache-Control': `no-cache`
      },
      render: {
        template: `static/htm/action-template.e.htm`,
        i18n: [
          `assets/i18n/action-template.override.json`
        ],
        view: {
          title: `Action Template Response`,
          message: `This template was rendered from an HTTP action response.`,
          requestedName: requestData?.query?.name ?? null,
          requestPath: requestData?.path ?? null
        }
      }
    };
  }
};

Object.freeze(module.exports);
