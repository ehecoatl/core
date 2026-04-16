'use strict';

function reconcileRegistryState({
  registry,
  persistedTenantsById = new Map(),
  portStart = 14_002,
  portEnd = 65_534
}) {
  if (!(registry?.domains instanceof Map)) {
    throw new Error(`Tenant registry reconciliation requires registry.domains to be a Map`);
  }

  if (portStart < 1 || portEnd < portStart) {
    throw new Error(`Invalid internal proxy port range ${portStart}-${portEnd}`);
  }

  const aliasesByDomain = buildAliasesByDomain(registry.domainAliases);
  const sortedTenants = [...registry.domains.values()].sort(compareTenantRecords);
  const usedPorts = new Set();
  const nextDomains = new Map();

  for (const tenantRecord of sortedTenants) {
    const tenantId = String(tenantRecord?.tenantId ?? ``).trim();
    if (!tenantId) continue;

    const persistedSnapshot = persistedTenantsById.get(tenantId) ?? null;
    const preferredPair = normalizeInternalProxyPair(persistedSnapshot?.internalProxy, { portStart, portEnd });
    const assignedPair = preferredPair && pairIsAvailable(preferredPair, usedPorts)
      ? preferredPair
      : allocateFirstFreePair({ usedPorts, portStart, portEnd });

    usedPorts.add(assignedPair.httpPort);
    usedPorts.add(assignedPair.wsPort);

    const tenantDomain = String(tenantRecord?.domain ?? ``).trim().toLowerCase();
    const aliases = Object.freeze((aliasesByDomain.get(tenantDomain) ?? []).slice().sort());
    nextDomains.set(tenantDomain, Object.freeze({
      ...tenantRecord,
      aliases,
      internalProxy: Object.freeze(assignedPair),
      certificateAutomation: normalizeCertificateAutomation(persistedSnapshot?.certificateAutomation)
    }));
  }

  return Object.freeze({
    hosts: registry.hosts,
    domains: nextDomains,
    domainAliases: registry.domainAliases,
    appAliases: registry.appAliases,
    invalidHosts: registry.invalidHosts
  });
}

function compareTenantRecords(left, right) {
  const leftId = String(left?.tenantId ?? ``);
  const rightId = String(right?.tenantId ?? ``);
  return leftId.localeCompare(rightId);
}

function buildAliasesByDomain(domainAliases) {
  const aliasesByDomain = new Map();
  if (!(domainAliases instanceof Map)) return aliasesByDomain;

  for (const [aliasDomain, aliasConfig] of domainAliases.entries()) {
    const alias = String(aliasDomain ?? ``).trim().toLowerCase();
    const point = String(aliasConfig?.point ?? ``).trim().toLowerCase();
    if (!alias || !point) continue;
    const aliases = aliasesByDomain.get(point) ?? [];
    aliases.push(alias);
    aliasesByDomain.set(point, aliases);
  }

  return aliasesByDomain;
}

function normalizeInternalProxyPair(internalProxy, { portStart, portEnd }) {
  const httpPort = Number(internalProxy?.httpPort);
  const wsPort = Number(internalProxy?.wsPort);
  if (!Number.isInteger(httpPort) || !Number.isInteger(wsPort)) return null;
  if (httpPort < portStart || wsPort > portEnd) return null;
  if (wsPort !== httpPort + 1) return null;
  return Object.freeze({ httpPort, wsPort });
}

function pairIsAvailable(pair, usedPorts) {
  return !usedPorts.has(pair.httpPort) && !usedPorts.has(pair.wsPort);
}

function allocateFirstFreePair({ usedPorts, portStart, portEnd }) {
  for (let candidate = portStart; candidate < portEnd; candidate += 2) {
    const pair = {
      httpPort: candidate,
      wsPort: candidate + 1
    };
    if (pair.wsPort > portEnd) break;
    if (pairIsAvailable(pair, usedPorts)) {
      return Object.freeze(pair);
    }
  }

  throw new Error(`No free internal proxy port pair available in range ${portStart}-${portEnd}`);
}

function normalizeCertificateAutomation(certificateAutomation) {
  const triggeredDomains = certificateAutomation?.letsEncryptTriggeredDomains;
  if (!triggeredDomains || typeof triggeredDomains !== `object`) {
    return Object.freeze({
      letsEncryptTriggeredDomains: Object.freeze({})
    });
  }

  const normalizedTriggeredDomains = Object.entries(triggeredDomains).reduce((carry, [domain, entry]) => {
    const normalizedDomain = String(domain ?? ``).trim().toLowerCase();
    if (!normalizedDomain) return carry;
    carry[normalizedDomain] = Object.freeze({
      startedAt: Number(entry?.startedAt ?? 0) || 0,
      expiresAt: Number(entry?.expiresAt ?? 0) || 0,
      source: String(entry?.source ?? `certificate-service`)
    });
    return carry;
  }, {});

  return Object.freeze({
    letsEncryptTriggeredDomains: Object.freeze(normalizedTriggeredDomains)
  });
}

module.exports = {
  reconcileRegistryState
};

Object.freeze(module.exports);
