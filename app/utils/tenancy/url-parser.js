// utils/tenancy/url-parser.js


'use strict';


module.exports = function (url) {
  const slash = url.indexOf(`/`);
  const host = (slash === -1 ? url : url.slice(0, slash)).toLowerCase();
  const uri = (slash === -1 ? `/` : url.slice(slash)).toLowerCase();

  return {
    host,
    uri
  }
}
