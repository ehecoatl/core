'use strict';

const path = require(`node:path`);

function buildTenantSourceRenderModel(source) {
  const kind = normalizeKind(source?.kind);
  const tenantId = String(source?.tenantId ?? ``).trim();
  const tenantDomain = String(source?.tenantDomain ?? ``).trim().toLowerCase();
  const domain = String(source?.domain ?? tenantDomain).trim().toLowerCase();
  if (!tenantId || !tenantDomain || !domain) {
    throw new Error(`Nginx tenant source requires tenantId, tenantDomain and domain`);
  }

  const httpPort = Number(source?.internalProxy?.httpPort);
  const wsPort = Number(source?.internalProxy?.wsPort);
  if (!Number.isInteger(httpPort) || !Number.isInteger(wsPort)) {
    throw new Error(`Nginx tenant source requires internalProxy.httpPort and internalProxy.wsPort`);
  }

  const tenantRoot = String(source?.tenantRoot ?? ``).trim();
  const serviceRoot = tenantRoot ? path.join(tenantRoot, `.ehecoatl`) : null;
  const logsRoot = serviceRoot ? path.join(serviceRoot, `log`) : null;
  const effectiveTls = normalizeEffectiveTls(source?.effectiveTls);
  const exactHostOnly = kind !== `tenant-primary` && kind !== `tenant-alias`;
  const serverNames = exactHostOnly
    ? domain
    : [domain, `*.${domain}`].join(` `);
  const forcedAppId = kind.startsWith(`app-`)
    ? String(source?.forcedAppId ?? ``).trim().toLowerCase()
    : ``;

  return Object.freeze({
    kind,
    tenantId,
    tenantDomain,
    domain,
    tenantRoot,
    cacheRoot: serviceRoot ? path.join(serviceRoot, `.cache`) : null,
    serverNames,
    hostname: domain,
    hostnameSupplemental: exactHostOnly ? `` : `*.${domain}`,
    httpPort,
    wsPort,
    wsPathPrefix: `/ws`,
    httpUpstreamHost: `127.0.0.1`,
    wsUpstreamHost: `127.0.0.1`,
    forcedAppId,
    proxyTargetHeader: `X-Ehecoatl-Target-App-Id`,
    tlsMode: effectiveTls.mode,
    tlsCertPath: effectiveTls.certPath,
    tlsKeyPath: effectiveTls.keyPath,
    httpRedirectToHttps: effectiveTls.httpRedirectToHttps,
    httpsEnabled: effectiveTls.httpsEnabled,
    accessLogPath: logsRoot ? path.join(logsRoot, `nginx.access.log`) : ``,
    errorLogPath: logsRoot ? path.join(logsRoot, `nginx.error.log`) : ``,
    limitReqZoneName: `ehecoatl_req_${sanitizeDomainToken(domain)}`,
    limitReqZoneSize: `10m`,
    limitReqRate: `10r/s`,
    limitReqBurst: `20`,
    limitReqMode: `nodelay`,
    limitConnZoneName: `ehecoatl_conn_${sanitizeDomainToken(domain)}`,
    limitConnZoneSize: `10m`,
    limitConnPerIp: `20`
  });
}

function renderTenantTemplate(templateContent, source) {
  const model = buildTenantSourceRenderModel(source);
  const replacements = new Map([
    [`{{TENANT_ID}}`, model.tenantId],
    [`{{TENANT_DOMAIN}}`, model.tenantDomain],
    [`{{SERVER_NAMES}}`, model.serverNames],
    [`{{HTTP_UPSTREAM_HOST}}`, model.httpUpstreamHost],
    [`{{HTTP_UPSTREAM_PORT}}`, String(model.httpPort)],
    [`{{WS_UPSTREAM_HOST}}`, model.wsUpstreamHost],
    [`{{WS_UPSTREAM_PORT}}`, String(model.wsPort)],
    [`@t(tenant_id)`, model.tenantId],
    [`@t(tenant_root)`, model.tenantRoot],
    [`@t(cache_root)`, model.cacheRoot],
    [`@t(hostname)`, model.hostname],
    [`@t(hostname_www)`, model.hostnameSupplemental],
    [`@t(http_ingress_port)`, String(model.httpPort)],
    [`@t(ws_ingress_port)`, String(model.wsPort)],
    [`@t(ws_path_prefix)`, model.wsPathPrefix],
    [`@t(limit_req_zone_name)`, model.limitReqZoneName],
    [`@t(limit_req_zone_size)`, model.limitReqZoneSize],
    [`@t(limit_req_rate)`, model.limitReqRate],
    [`@t(limit_req_burst)`, model.limitReqBurst],
    [`@t(limit_req_mode)`, model.limitReqMode],
    [`@t(limit_conn_zone_name)`, model.limitConnZoneName],
    [`@t(limit_conn_zone_size)`, model.limitConnZoneSize],
    [`@t(limit_conn_per_ip)`, model.limitConnPerIp],
    [`@t(tls_cert_path)`, model.tlsCertPath],
    [`@t(tls_key_path)`, model.tlsKeyPath],
    [`@t(access_log_path)`, model.accessLogPath],
    [`@t(error_log_path)`, model.errorLogPath]
  ]);

  let rendered = String(templateContent ?? ``);
  for (const [token, value] of replacements.entries()) {
    rendered = rendered.split(token).join(value ?? ``);
  }

  rendered = rendered.replace(/server_name\s+[^;]+;/g, `server_name ${model.serverNames};`);
  rendered = rendered.replaceAll(BASE_PROXY_HEADER_BLOCK, createProxyHeaderBlock(model));

  if (!model.httpRedirectToHttps) {
    rendered = rendered.replace(
      `    return 301 https://$host$request_uri;`,
      createHttpProxyBlock(model)
    );
  }

  if (!model.httpsEnabled) {
    rendered = rendered.replace(/\nserver\s*\{\n\s*listen 443 ssl http2;[\s\S]*?\n\}\s*$/m, `\n`);
  }

  return rendered;
}

module.exports = {
  buildTenantSourceRenderModel,
  renderTenantTemplate
};

Object.freeze(module.exports);

function normalizeKind(kind) {
  const normalized = String(kind ?? `tenant-primary`).trim().toLowerCase();
  if ([`tenant-primary`, `tenant-alias`, `app-alias`, `app-default-root`, `app-default-domain`, `app-domain`].includes(normalized)) {
    return normalized;
  }
  return `tenant-primary`;
}

function normalizeEffectiveTls(effectiveTls) {
  const normalizedMode = String(effectiveTls?.mode ?? `none`).trim().toLowerCase();
  const certPath = String(effectiveTls?.certPath ?? ``).trim();
  const keyPath = String(effectiveTls?.keyPath ?? ``).trim();
  const httpsEnabled = Boolean(effectiveTls?.httpsEnabled && certPath && keyPath);

  return Object.freeze({
    mode: normalizedMode || `none`,
    certPath,
    keyPath,
    httpsEnabled,
    httpRedirectToHttps: Boolean(effectiveTls?.httpRedirectToHttps && httpsEnabled)
  });
}

function createInternalLocations(model) {
  return [
    `    location ^~ /_ehecoatl_internal/static/ {`,
    `        internal;`,
    `        alias ${model.tenantRoot}/;`,
    `    }`,
    ``,
    `    location ^~ /_ehecoatl_internal/cache/ {`,
    `        internal;`,
    `        alias ${model.cacheRoot}/;`,
    `    }`
  ].join(`\n`);
}

function createProxyHeaderBlock(model) {
  const targetAppHeader = model.forcedAppId
    ? `        proxy_set_header ${model.proxyTargetHeader} ${model.forcedAppId};`
    : `        proxy_set_header ${model.proxyTargetHeader} "";`;

  return [
    `        proxy_set_header Host $host;`,
    `        proxy_set_header X-Real-IP $remote_addr;`,
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto $scheme;`,
    `        proxy_set_header X-Forwarded-Host $host;`,
    `        proxy_set_header X-Forwarded-Port $server_port;`,
    `        proxy_set_header X-Forwarded-Method $request_method;`,
    `        proxy_set_header X-Forwarded-Uri $uri;`,
    `        proxy_set_header X-Forwarded-Query $args;`,
    targetAppHeader
  ].join(`\n`);
}

const BASE_PROXY_HEADER_BLOCK = [
  `        proxy_set_header Host $host;`,
  `        proxy_set_header X-Real-IP $remote_addr;`,
  `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
  `        proxy_set_header X-Forwarded-Proto $scheme;`,
  `        proxy_set_header X-Forwarded-Host $host;`,
  `        proxy_set_header X-Forwarded-Port $server_port;`,
  `        proxy_set_header X-Forwarded-Method $request_method;`,
  `        proxy_set_header X-Forwarded-Uri $uri;`,
  `        proxy_set_header X-Forwarded-Query $args;`
].join(`\n`);

function createHttpProxyBlock(model) {
  return [
    createInternalLocations(model),
    ``,
    `    location = ${model.wsPathPrefix} {`,
    `        proxy_pass http://${model.wsUpstreamHost}:${model.wsPort};`,
    `        proxy_http_version 1.1;`,
    `        proxy_buffering off;`,
    `        proxy_request_buffering off;`,
    ``,
    createProxyHeaderBlock(model),
    ``,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection "upgrade";`,
    ``,
    `        proxy_read_timeout 600s;`,
    `        proxy_send_timeout 600s;`,
    `    }`,
    ``,
    `    location ^~ ${model.wsPathPrefix}/ {`,
    `        proxy_pass http://${model.wsUpstreamHost}:${model.wsPort};`,
    `        proxy_http_version 1.1;`,
    `        proxy_buffering off;`,
    `        proxy_request_buffering off;`,
    ``,
    createProxyHeaderBlock(model),
    ``,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection "upgrade";`,
    ``,
    `        proxy_read_timeout 600s;`,
    `        proxy_send_timeout 600s;`,
    `    }`,
    ``,
    `    location ~ ^(.+?)/+$ {`,
    `        return 308 $scheme://$host$1$is_args$args;`,
    `    }`,
    ``,
    `    location / {`,
    `        proxy_pass http://${model.httpUpstreamHost}:${model.httpPort};`,
    `        proxy_http_version 1.1;`,
    `        proxy_buffering on;`,
    `        proxy_request_buffering on;`,
    ``,
    createProxyHeaderBlock(model),
    ``,
    `        proxy_read_timeout 300s;`,
    `        proxy_send_timeout 300s;`,
    `    }`
  ].join(`\n`);
}

function sanitizeDomainToken(domain) {
  const normalized = String(domain ?? ``).trim().toLowerCase();
  const sanitized = normalized
    .replace(/[^a-z0-9]+/g, `_`)
    .replace(/^_+|_+$/g, ``);
  return sanitized || `host`;
}
