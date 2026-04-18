'use strict';

const {
  normalizeAuthScopes
} = require(`../../utils/_security-support`);

module.exports = async function authMiddleware(middlewareContext, next) {
  const auth = middlewareContext.sessionData?.auth ?? null;
  if (!auth || typeof auth !== `object`) {
    middlewareContext.setStatus(401);
    middlewareContext.setHeader(`Content-Type`, `application/json`);
    middlewareContext.setBody({
      success: false,
      error: `auth_required`
    });
    return;
  }

  const requiredScopes = normalizeRequiredScopes(middlewareContext.tenantRoute?.authScope);
  if (requiredScopes.length > 0) {
    const currentScopes = new Set(normalizeAuthScopes(auth));
    const hasAllScopes = requiredScopes.every((scope) => currentScopes.has(scope));
    if (!hasAllScopes) {
      middlewareContext.setStatus(403);
      middlewareContext.setHeader(`Content-Type`, `application/json`);
      middlewareContext.setBody({
        success: false,
        error: `auth_scope_forbidden`,
        requiredScopes
      });
      return;
    }
  }

  await next();
};

function normalizeRequiredScopes(authScope) {
  if (authScope == null) return [];
  const list = Array.isArray(authScope) ? authScope : [authScope];
  return list
    .map((scope) => String(scope ?? ``).trim())
    .filter(Boolean);
}
