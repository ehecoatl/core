// adapters/outbound/tenant-route-matcher-compiler/default-routing-v1.js


'use strict';

const TenantRouteMatcherCompilerPort = require(`@/_core/_ports/outbound/tenant-route-matcher-compiler-port`);
const TenantRouteMeta = require(`@/_core/runtimes/ingress-runtime/execution/tenant-route-meta`);
const tenantRoutesCompiler = require(`@/utils/tenancy/tenant-routes-compiler`);

TenantRouteMatcherCompilerPort.compileRoutesAdapter = async function compileRoutesAdapter({
  routesAvailable
}) {
  const flattenedRoutes = {};
  flattenRoutes(routesAvailable, ``, flattenedRoutes);
  const normalizedRoutes = Object.keys(flattenedRoutes).length > 0
    ? flattenedRoutes
    : null;

  return {
    routesAvailable: normalizedRoutes,
    compiledRoutes: normalizedRoutes ? tenantRoutesCompiler(normalizedRoutes) : []
  };
};

module.exports = TenantRouteMatcherCompilerPort;
Object.freeze(module.exports);

function flattenRoutes(routeMap, prefixPath, flattenedRoutes) {
  if (!isPlainObject(routeMap)) return;

  for (const [routePath, routeValue] of Object.entries(routeMap)) {
    if (!String(routePath ?? ``).startsWith(`/`)) continue;
    const fullPath = normalizeRoutePath(prefixPath, routePath);

    if (isPrefixGroup(routeValue)) {
      flattenRoutes(routeValue, fullPath, flattenedRoutes);
      continue;
    }

    flattenedRoutes[fullPath] = normalizeRouteDefinition(routeValue, fullPath);
  }
}

function isPrefixGroup(routeValue) {
  if (!isPlainObject(routeValue)) return false;
  return Object.keys(routeValue).some((childKey) => String(childKey ?? ``).startsWith(`/`));
}

function normalizeRoutePath(prefixPath, routePath) {
  const prefix = String(prefixPath ?? ``).trim();
  const route = String(routePath ?? ``).trim();
  const combined = `${prefix}${route}`.replace(/\/+/g, `/`);
  if (!combined) return `/`;
  return combined.startsWith(`/`) ? combined : `/${combined}`;
}

function isPlainObject(value) {
  return value != null && typeof value === `object` && !Array.isArray(value);
}

function normalizeRouteDefinition(routeValue, routePath) {
  return TenantRouteMeta.normalizeRouteConfig(routeValue, routePath);
}
