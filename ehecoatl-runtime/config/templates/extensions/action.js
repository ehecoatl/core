'use strict';

module.exports = {
  // Default action method called by routes that point to "<resource>@index".
  // Put your application logic inside this method or add more exported methods.
  async index() {
    return {
      // HTTP-like status returned to the transport runtime.
      status: 200,
      body: {
        // Replace this payload with your custom response data.
        ok: true
      }
    };
  }
};
