'use strict';

const path = require(`node:path`);
const { createTenantFacingErrorResponse } = require(`@/utils/http/tenant-facing-error-response`);
const { createStaticAssetInternalRedirect } = require(`./_static-stream-support`);

module.exports = async function runMiddleware(middlewareContext, next) {
  const forward = createFlowController(next);
  const { tenantRoute } = middlewareContext;
  if (!tenantRoute.isStaticAsset()) {
    return forward.continue();
  }

  const assetPath = tenantRoute.assetPath();
  const eRendererRuntime = middlewareContext?.services?.eRendererRuntime ?? null;
  if (eRendererRuntime?.isCompatibleTemplate?.(assetPath)) {
    const exists = await middlewareContext?.services?.storage?.fileExists?.(assetPath).catch(() => false);
    if (!exists) {
      applyResponse(middlewareContext, createTenantFacingErrorResponse({
        status: 404,
        productionBody: `Not Found`,
        nonProductionBody: `Static asset route resolved, but the target file was not found in this non-production environment.`,
        nonProductionDetails: [
          `Asset path: ${assetPath}`
        ]
      }));
      return forward.break();
    }

    const i18nJSONSources = resolveI18nSourcePaths(tenantRoute);
    const renderedStream = await eRendererRuntime.renderView(assetPath, i18nJSONSources, {
      request: middlewareContext?.requestData ?? null,
      session: middlewareContext?.sessionData ?? null,
      route: tenantRoute ?? null,
      meta: middlewareContext?.meta ?? null,
      view: middlewareContext?.viewData ?? {}
    });
    const contentType = resolveRenderableContentType(assetPath);
    if (contentType) {
      middlewareContext.setHeader(`Content-Type`, contentType);
    }
    middlewareContext.setBody(renderedStream);
    return forward.break();
  }

  const internalRedirect = await createStaticAssetInternalRedirect(middlewareContext, assetPath);
  if (internalRedirect) {
    middlewareContext.setBody(internalRedirect);
    return forward.break();
  }

  applyResponse(middlewareContext, createTenantFacingErrorResponse({
    status: 404,
    productionBody: `Not Found`,
    nonProductionBody: `Static asset route resolved, but the target file was not found in this non-production environment.`,
    nonProductionDetails: [
      `Asset path: ${assetPath}`
    ]
  }));
  return forward.break();
};

function applyResponse(middlewareContext, response) {
  middlewareContext.setStatus(response.status);
  middlewareContext.setBody(response.body);

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    middlewareContext.setHeader(key, value);
  }
}

function createFlowController(next) {
  const hasNext = typeof next === `function`;
  return Object.freeze({
    continue: () => hasNext ? next() : true,
    break: () => hasNext ? undefined : false
  });
}

function resolveI18nSourcePaths(tenantRoute) {
  const rootFolder = String(tenantRoute?.folders?.rootFolder ?? ``).trim();
  const entries = Array.isArray(tenantRoute?.i18n) ? tenantRoute.i18n : [];
  if (!rootFolder || entries.length === 0) {
    return [];
  }

  const normalizedRoot = path.resolve(rootFolder);
  return entries.map((relativePath) => {
    const normalizedRelativePath = String(relativePath ?? ``).trim();
    if (!normalizedRelativePath || path.isAbsolute(normalizedRelativePath)) {
      throw new Error(`Route i18n entries must be non-empty relative paths`);
    }

    const resolvedPath = path.resolve(normalizedRoot, normalizedRelativePath);
    if (
      resolvedPath !== normalizedRoot &&
      !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      throw new Error(`Route i18n entry escapes route root: ${normalizedRelativePath}`);
    }

    return resolvedPath;
  });
}

function resolveRenderableContentType(assetPath) {
  const normalizedPath = String(assetPath ?? ``).trim().toLowerCase();
  if (normalizedPath.endsWith(`.e.htm`) || normalizedPath.endsWith(`.e.html`)) {
    return `text/html; charset=utf-8`;
  }
  if (normalizedPath.endsWith(`.e.txt`)) {
    return `text/plain; charset=utf-8`;
  }
  return null;
}
