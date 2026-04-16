'use strict';

const path = require(`node:path`);

const context = require(path.join(__dirname, `..`, `..`, `contracts`, `context.js`));
const tenantLayout = require(path.join(__dirname, `..`, `..`, `utils`, `tenancy`, `tenant-layout.js`));

const superWorkspaceLinks = Object.freeze([
  Object.freeze({
    relativePath: `config`,
    targetPath: path.join(context.serviceOverrideRoot, `config`),
    scope: `super`
  }),
  Object.freeze({
    relativePath: `srv`,
    targetPath: context.serviceSrvRoot,
    scope: `super`
  }),
  Object.freeze({
    relativePath: `tenants`,
    targetPath: context.serviceTenantsRoot,
    scope: `super`
  }),
  Object.freeze({
    relativePath: `logs`,
    targetPath: context.serviceLogRoot,
    scope: `super`
  }),
  Object.freeze({
    relativePath: `var`,
    targetPath: context.serviceVarRoot,
    scope: `super`
  }),
  Object.freeze({
    relativePath: `runtime`,
    targetPath: context.serviceLibRoot,
    scope: `super`
  })
]);

function buildManagedLoginWorkspacePlan({
  scopeSelectors = [],
  tenantsBase = context.serviceTenantsRoot,
  workspaceHome
} = {}) {
  const normalizedWorkspaceHome = String(workspaceHome ?? ``).trim();
  if (!normalizedWorkspaceHome) {
    throw new Error(`workspaceHome is required`);
  }

  const resolvedGroups = [];
  const resolvedScopes = [];

  for (const rawSelector of scopeSelectors) {
    const selector = String(rawSelector ?? ``).trim();
    if (!selector) continue;

    const resolvedScope = resolveScopeSelector({
      selector,
      tenantsBase
    });
    appendUnique(resolvedGroups, resolvedScope.group);
    resolvedScopes.push(resolvedScope);
  }

  if (resolvedGroups.length === 0) {
    throw new Error(`At least one valid scope selector is required.`);
  }

  const workspaceLinks = [];
  const seenRelativePaths = new Set();
  const hasSuperScope = resolvedScopes.some((entry) => entry.kind === `super`);

  if (hasSuperScope) {
    for (const link of superWorkspaceLinks) {
      pushWorkspaceLink({
        workspaceLinks,
        seenRelativePaths,
        workspaceHome: normalizedWorkspaceHome,
        ...link
      });
    }
  }

  for (const entry of resolvedScopes) {
    if (entry.kind === `tenant` && !hasSuperScope) {
      pushWorkspaceLink({
        workspaceLinks,
        seenRelativePaths,
        workspaceHome: normalizedWorkspaceHome,
        relativePath: path.join(`tenants`, `tenant_${entry.tenantId}`),
        targetPath: entry.tenantRoot,
        scope: `tenant`,
        selector: entry.selector,
        tenantId: entry.tenantId
      });
    }

    if (entry.kind === `app`) {
      pushWorkspaceLink({
        workspaceLinks,
        seenRelativePaths,
        workspaceHome: normalizedWorkspaceHome,
        relativePath: path.join(`apps`, `app_${entry.appId}`),
        targetPath: entry.appRoot,
        scope: `app`,
        selector: entry.selector,
        tenantId: entry.tenantId,
        appId: entry.appId
      });
    }
  }

  return Object.freeze({
    workspaceHome: normalizedWorkspaceHome,
    resolvedGroups: Object.freeze([...resolvedGroups]),
    workspaceLinks: Object.freeze(workspaceLinks.map((entry) => Object.freeze({ ...entry })))
  });
}

function resolveScopeSelector({
  selector,
  tenantsBase
}) {
  if (selector === `super`) {
    return Object.freeze({
      kind: `super`,
      selector,
      group: `g_superScope`
    });
  }

  if (/^tenant:@[a-z0-9]{12}$/.test(selector)) {
    const tenantId = selector.slice(`tenant:@`.length);
    const tenantRecord = tenantLayout.findOpaqueTenantRecordByIdSync({
      tenantsBase,
      tenantId
    });

    if (!tenantRecord) {
      throw new Error(`Tenant selector '${selector}' not found.`);
    }

    return Object.freeze({
      kind: `tenant`,
      selector,
      group: `g_${tenantRecord.tenantId}`,
      tenantId: tenantRecord.tenantId,
      tenantRoot: tenantRecord.tenantRoot
    });
  }

  if (selector.startsWith(`tenant:@`)) {
    const tenantRecord = tenantLayout.findOpaqueTenantRecordByDomainSync({
      tenantsBase,
      tenantDomain: selector.slice(`tenant:@`.length)
    });

    if (!tenantRecord) {
      throw new Error(`Tenant selector '${selector}' not found.`);
    }

    return Object.freeze({
      kind: `tenant`,
      selector,
      group: `g_${tenantRecord.tenantId}`,
      tenantId: tenantRecord.tenantId,
      tenantRoot: tenantRecord.tenantRoot
    });
  }

  let appRecord = null;
  if ((/^app:([a-z0-9]{12})@([a-z0-9]{12})$/).test(selector)) {
    const match = selector.match(/^app:([a-z0-9]{12})@([a-z0-9]{12})$/);
    appRecord = tenantLayout.findOpaqueAppRecordByTenantIdAndAppIdSync({
      tenantsBase,
      tenantId: match[2],
      appId: match[1]
    });
  } else if ((/^app:([a-z0-9._-]+)@([a-z0-9]{12})$/).test(selector)) {
    const match = selector.match(/^app:([a-z0-9._-]+)@([a-z0-9]{12})$/);
    appRecord = tenantLayout.findOpaqueAppRecordByTenantIdAndAppNameSync({
      tenantsBase,
      tenantId: match[2],
      appName: match[1]
    });
  } else if ((/^app:([a-z0-9._-]+)@([a-z0-9.-]+)$/).test(selector)) {
    const match = selector.match(/^app:([a-z0-9._-]+)@([a-z0-9.-]+)$/);
    appRecord = tenantLayout.findOpaqueAppRecordByDomainAndAppNameSync({
      tenantsBase,
      tenantDomain: match[2],
      appName: match[1]
    });
  }

  if (!appRecord) {
    throw new Error(`App selector '${selector}' not found.`);
  }

  return Object.freeze({
    kind: `app`,
    selector,
    group: `g_${appRecord.tenantId}_${appRecord.appId}`,
    tenantId: appRecord.tenantId,
    appId: appRecord.appId,
    appRoot: appRecord.appRoot
  });
}

function appendUnique(target, value) {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function pushWorkspaceLink({
  workspaceLinks,
  seenRelativePaths,
  workspaceHome,
  relativePath,
  targetPath,
  scope,
  selector = null,
  tenantId = null,
  appId = null
}) {
  const normalizedRelativePath = String(relativePath ?? ``).trim();
  if (!normalizedRelativePath || seenRelativePaths.has(normalizedRelativePath)) {
    return;
  }

  seenRelativePaths.add(normalizedRelativePath);
  workspaceLinks.push({
    relativePath: normalizedRelativePath,
    linkPath: path.join(workspaceHome, normalizedRelativePath),
    targetPath,
    scope,
    selector,
    tenantId,
    appId
  });
}

module.exports = {
  buildManagedLoginWorkspacePlan
};

Object.freeze(module.exports);
