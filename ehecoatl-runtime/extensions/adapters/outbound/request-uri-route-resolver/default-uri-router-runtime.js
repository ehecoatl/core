// adapters/outbound/request-uri-route-resolver/default-uri-router-runtime.js


'use strict';


const RequestUriRouteResolverPort = require(`@/_core/_ports/outbound/request-uri-route-resolver-port`);
const urlParser = require(`@/utils/tenancy/url-parser`);
const tenantRoutesFindMatch = require(`@/utils/tenancy/tenant-routes-find-match`);

RequestUriRouteResolverPort.matchRouteAdapter = async function ({
  url,
  registry = null,
  defaultAppName = `www`,
  tenantId = null,
  forcedAppId = null
}) {
  if (!url) return null;
  const { host: hostname, uri } = urlParser(url);
  const resolution = resolveHostAndApp({
    hostname,
    uri,
    registry,
    globalDefaultAppName: defaultAppName,
    tenantId,
    forcedAppId
  });
  const routeDataObject = resolution?.routeDataObject ?? null;
  console.log(
    `[default-uri-router-runtime.matchRouteAdapter] url=${url} hostname=${hostname} uri=${uri} routeFound=${routeDataObject ? `yes` : `no`} appURL=${resolution?.appURL ?? `null`} compiled=${Array.isArray(routeDataObject?.compiledRoutes) ? routeDataObject.compiledRoutes.length : `null`} mode=${resolution?.domainRoutingMode ?? `null`} canonicalDomain=${resolution?.resolvedDomain ?? `null`} app=${resolution?.appName ?? `null`} forcedAppId=${forcedAppId ?? `null`}`
  );
  if (!routeDataObject) return null;

  if (!Array.isArray(routeDataObject.compiledRoutes) || routeDataObject.compiledRoutes.length === 0) return null;
  const routeDataMatch = tenantRoutesFindMatch(
    resolution.internalUri,
    routeDataObject.compiledRoutes
  );
  if (!routeDataMatch) return null;
  const run = isRunGroup(routeDataMatch?.target?.run)
    ? {
      resource: routeDataMatch.target.run.resource,
      action: routeDataMatch.target.run.action
    }
    : null;

  return {
    ...routeDataMatch,
    origin: {
      hostname,
      appURL: resolution.appURL,
      domain: routeDataObject.domain,
      appName: routeDataObject.appName,
      tenantId: routeDataObject.tenantId,
      appId: routeDataObject.appId
    },
    resolvedDomain: resolution.resolvedDomain,
    resolvedViaAlias: resolution.resolvedViaAlias,
    domainRoutingMode: resolution.domainRoutingMode,
    tenantId: routeDataObject.tenantId,
    appId: routeDataObject.appId,
    folders: {
      tenantRootFolder: routeDataObject.tenantRootFolder,
      rootFolder: routeDataObject.rootFolder,
      actionsRootFolder: routeDataObject.actionsRootFolder,
      assetsRootFolder: routeDataObject.assetsRootFolder,
      httpMiddlewaresRootFolder: routeDataObject.httpMiddlewaresRootFolder,
      wsMiddlewaresRootFolder: routeDataObject.wsMiddlewaresRootFolder,
      routesRootFolder: routeDataObject.routesRootFolder
    },
    upload: {
      diskLimit: routeDataObject.diskLimit,
      diskLimitBytes: routeDataObject.diskLimitBytes,
      uploadPath: routeDataMatch?.upload?.uploadPath ?? null,
      uploadTypes: routeDataMatch?.upload?.uploadTypes ?? null
    },
    methodsAvailable: routeDataObject.methodsAvailable,
    target: {
      ...(routeDataMatch?.target ?? {}),
      run
    }
  };
};

function isRunGroup(value) {
  return value != null
    && typeof value === `object`
    && !Array.isArray(value)
    && typeof value.resource === `string`
    && value.resource.trim()
    && typeof value.action === `string`
    && value.action.trim();
}

function resolveHostAndApp({
  hostname,
  uri,
  registry,
  globalDefaultAppName = `www`,
  tenantId = null,
  forcedAppId = null
}) {
  const forcedResolution = resolveForcedApp({
    tenantId,
    forcedAppId,
    registry,
    originalUri: uri
  });
  if (forcedResolution) return forcedResolution;

  const appAliasResolution = resolveAppAlias({
    hostname,
    registry,
    originalUri: uri
  });
  if (appAliasResolution) return appAliasResolution;

  const resolution = resolveCanonicalDomain(hostname, registry);
  if (!resolution) return null;

  const domainConfig = getDomainConfig(resolution.resolvedDomain, registry, globalDefaultAppName);
  const routingMode = domainConfig.appRouting.mode;
  const effectiveDefaultAppName = domainConfig.appRouting.defaultAppName;

  if (routingMode === `path`) {
    return resolvePathMode({
      requestHostname: hostname,
      uri,
      registry,
      resolvedDomain: resolution.resolvedDomain,
      resolvedViaAlias: resolution.resolvedViaAlias,
      matchedAliasDomain: resolution.aliasDomain ?? null,
      defaultAppName: effectiveDefaultAppName
    });
  }

  return resolveSubdomainMode({
    requestHostname: hostname,
    registry,
    resolvedDomain: resolution.resolvedDomain,
    resolvedViaAlias: resolution.resolvedViaAlias,
    matchedAliasDomain: resolution.aliasDomain ?? null,
    defaultAppName: effectiveDefaultAppName,
    originalUri: uri
  });
}

function resolveForcedApp({
  tenantId,
  forcedAppId,
  registry,
  originalUri
}) {
  const normalizedTenantId = String(tenantId ?? ``).trim().toLowerCase();
  const normalizedForcedAppId = String(forcedAppId ?? ``).trim().toLowerCase();
  if (!normalizedTenantId || !normalizedForcedAppId) return null;

  const routeDataObject = findRouteDataByTenantAndApp({
    tenantId: normalizedTenantId,
    appId: normalizedForcedAppId,
    registry
  });
  if (!routeDataObject) return null;

  return Object.freeze({
    routeDataObject,
    appName: routeDataObject.appName,
    appURL: `${routeDataObject.appName}.${routeDataObject.domain}`,
    internalUri: normalizeFallbackInternalUri(originalUri),
    resolvedDomain: routeDataObject.domain,
    resolvedViaAlias: false,
    domainRoutingMode: `direct`
  });
}

function resolveAppAlias({
  hostname,
  registry,
  originalUri
}) {
  const normalizedHostname = String(hostname ?? ``).trim().toLowerCase();
  const appAliases = registry?.appAliases instanceof Map ? registry.appAliases : new Map();
  const appAliasRecord = appAliases.get(normalizedHostname) ?? null;
  if (!appAliasRecord) return null;

  const routeDataObject = findRouteDataByTenantAndApp({
    tenantId: appAliasRecord.tenantId,
    appId: appAliasRecord.appId,
    registry
  });
  if (!routeDataObject) return null;

  return Object.freeze({
    routeDataObject,
    appName: routeDataObject.appName,
    appURL: normalizedHostname,
    internalUri: normalizeFallbackInternalUri(originalUri),
    resolvedDomain: routeDataObject.domain,
    resolvedViaAlias: true,
    domainRoutingMode: `direct`
  });
}

function resolveCanonicalDomain(hostname, registry) {
  const normalizedHostname = String(hostname ?? ``).trim().toLowerCase();
  if (!normalizedHostname) return null;

  const directDomain = findMatchingDomain(normalizedHostname, registry?.domains);
  if (directDomain) {
    return {
      resolvedDomain: directDomain,
      resolvedViaAlias: false,
      aliasDomain: null
    };
  }

  const aliasDomain = findMatchingDomain(normalizedHostname, registry?.domainAliases);
  if (!aliasDomain) return null;
  const domainAlias = registry.domainAliases.get(aliasDomain);
  if (!domainAlias?.point) return null;

  return {
    resolvedDomain: domainAlias.point.toLowerCase(),
    resolvedViaAlias: true,
    aliasDomain
  };
}

function findMatchingDomain(hostname, domainMap) {
  if (!(domainMap instanceof Map)) return null;

  let matchedDomain = null;
  for (const domain of domainMap.keys()) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      if (!matchedDomain || domain.length > matchedDomain.length) {
        matchedDomain = domain;
      }
    }
  }
  return matchedDomain;
}

function getDomainConfig(domain, registry, globalDefaultAppName = `www`) {
  const domains = registry?.domains instanceof Map ? registry.domains : new Map();
  const domainRecord = domains.get(domain);
  return domainRecord ?? Object.freeze({
    domain,
    appRouting: Object.freeze({
      mode: `subdomain`,
      defaultAppName: globalDefaultAppName
    }),
    appNames: Object.freeze([])
  });
}

function resolveSubdomainMode({
  requestHostname,
  registry,
  resolvedDomain,
  resolvedViaAlias,
  matchedAliasDomain,
  defaultAppName,
  originalUri
}) {
  const hostPrefix = stripDomainSuffix(requestHostname, matchedAliasDomain ?? resolvedDomain);
  let requestedAppName = hostPrefix;
  if (!requestedAppName) {
    requestedAppName = defaultAppName;
  }

  const routeDataObject = findHostRouteData(`${requestedAppName}.${resolvedDomain}`, registry);
  if (!routeDataObject) return null;

  return {
    routeDataObject,
    appName: routeDataObject.appName,
    appURL: `${routeDataObject.appName}.${resolvedDomain}`,
    internalUri: originalUri,
    resolvedDomain,
    resolvedViaAlias,
    domainRoutingMode: `subdomain`
  };
}

function resolvePathMode({
  requestHostname,
  uri,
  registry,
  resolvedDomain,
  resolvedViaAlias,
  matchedAliasDomain,
  defaultAppName
}) {
  const hostPrefix = stripDomainSuffix(requestHostname, matchedAliasDomain ?? resolvedDomain);
  if (hostPrefix && hostPrefix !== `www`) return null;

  const { firstSegment, remainderUri } = splitUriIntoAppAndRoute(uri);
  if (firstSegment) {
    const explicitRouteData = findHostRouteData(`${firstSegment}.${resolvedDomain}`, registry);
    if (explicitRouteData) {
      return {
        routeDataObject: explicitRouteData,
        appName: explicitRouteData.appName,
        appURL: `${resolvedDomain}/${explicitRouteData.appName}`,
        internalUri: remainderUri,
        resolvedDomain,
        resolvedViaAlias,
        domainRoutingMode: `path`
      };
    }
  }

  const fallbackRouteData = findHostRouteData(`${defaultAppName}.${resolvedDomain}`, registry);
  if (!fallbackRouteData) return null;
  return {
    routeDataObject: fallbackRouteData,
    appName: fallbackRouteData.appName,
    appURL: `${resolvedDomain}/${fallbackRouteData.appName}`,
    internalUri: normalizeFallbackInternalUri(uri),
    resolvedDomain,
    resolvedViaAlias,
    domainRoutingMode: `path`
  };
}

function stripDomainSuffix(requestHostname, matchedDomain) {
  const normalizedHostname = String(requestHostname ?? ``).trim().toLowerCase();
  const normalizedMatchedDomain = String(matchedDomain ?? ``).trim().toLowerCase();
  if (!normalizedMatchedDomain) return normalizedHostname;
  if (normalizedHostname === normalizedMatchedDomain) return ``;
  if (normalizedHostname.endsWith(`.${normalizedMatchedDomain}`)) {
    return normalizedHostname.slice(0, -(normalizedMatchedDomain.length + 1));
  }
  return normalizedHostname;
}

function splitUriIntoAppAndRoute(uri) {
  const normalizedUri = typeof uri === `string` && uri.length > 0 ? uri : `/`;
  const trimmed = normalizedUri.replace(/^\/+/, ``);
  if (!trimmed) {
    return {
      firstSegment: null,
      remainderUri: `/`
    };
  }

  const slashIndex = trimmed.indexOf(`/`);
  if (slashIndex === -1) {
    return {
      firstSegment: trimmed,
      remainderUri: `/`
    };
  }

  return {
    firstSegment: trimmed.slice(0, slashIndex),
    remainderUri: `/${trimmed.slice(slashIndex + 1)}`
  };
}

function normalizeFallbackInternalUri(uri) {
  const normalizedUri = typeof uri === `string` && uri.length > 0 ? uri : `/`;
  return normalizedUri.startsWith(`/`) ? normalizedUri : `/${normalizedUri}`;
}

function findHostRouteData(appHostname, registry) {
  const hosts = registry?.hosts instanceof Map ? registry.hosts : new Map();
  return hosts.get(String(appHostname ?? ``).toLowerCase()) ?? null;
}

function findRouteDataByTenantAndApp({
  tenantId,
  appId,
  registry
}) {
  const hosts = registry?.hosts instanceof Map ? registry.hosts : new Map();
  for (const routeDataObject of hosts.values()) {
    if (String(routeDataObject?.tenantId ?? ``).trim().toLowerCase() !== String(tenantId ?? ``).trim().toLowerCase()) continue;
    if (String(routeDataObject?.appId ?? ``).trim().toLowerCase() !== String(appId ?? ``).trim().toLowerCase()) continue;
    return routeDataObject;
  }
  return null;
}

module.exports = RequestUriRouteResolverPort;
Object.freeze(module.exports);
