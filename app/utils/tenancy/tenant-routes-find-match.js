// utils/tenancy/tenant-routes-find-match.js


'use strict';


const TYPE_STATIC = 0;
const TYPE_DYNAMIC = 1;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}

function replaceTemplate(input, replacements) {
  if (typeof input !== `string`) return input;

  let output = input;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replace(
      new RegExp(escapeRegExp(key), `g`),
      String(value)
    );
  }
  return output;
}

module.exports = function tenantRoutesFindMatch(
  routeURI,
  compiledRoutes
) {

  for (const route of compiledRoutes) {

    if (route.type === TYPE_STATIC) {
      if (route.pattern === routeURI)
        return { ...route.route_data };
      continue;
    }

    const match = routeURI.match(route.regexp);
    if (!match) continue;

    const values = match.slice(1);

    const rep_data = Object.fromEntries(
      route.keys.map((key, i) => [key, values[i]])
    );

    const route_data = { ...route.route_data };

    rep_data[`{full_uri}`] = routeURI;

    for (const i in route_data) {
      if (Array.isArray(route_data[i]))
        route_data[i] = route_data[i].map((value) => replaceTemplate(value, rep_data));
      else if (typeof route_data[i] === `string`)
        route_data[i] = replaceTemplate(route_data[i], rep_data);
    }

    return route_data;
  }

  return null;
}
