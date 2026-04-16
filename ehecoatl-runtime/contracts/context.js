// ehecoatl-runtime/contracts/context.js


'use strict';


const service = `ehecoatl`;

const serviceInstallRoot = `/opt/${service}`;
const serviceOverrideRoot = `/etc/opt/${service}`;
const serviceExtensionsRoot = `/opt/${service}/extensions`;
const serviceVarRoot = `/var/opt/${service}`;
const serviceLibRoot = `/var/lib/${service}`;
const serviceLogRoot = `/var/log/${service}`;
const serviceSrvRoot = `/srv/opt/${service}`;
const serviceTenantsRoot = `/var/opt/${service}/tenants`;

const tenantRoot = `${serviceTenantsRoot}/tenant_{tenant_id}`;
const appRoot = `${tenantRoot}/app_{app_id}`;

const group = {
  internalScope: service,
  superScope: `g_superScope`,
  directorScope: `g_director`,
  tenantScope: `g_tenantScope_{tenant_id}`,
  appScope: `g_app_{tenant_id}_{app_id}`
};

const user = {
  internalUser: service,
  supervisorUser: `u_supervisor_{install_id}`,
  tenantUser: `u_tenant_{tenant_id}`,
  appUser: `u_app_{tenant_id}_{app_id}`
};

module.exports = {
  service,
  serviceInstallRoot,
  serviceOverrideRoot,
  serviceTenantsRoot,
  serviceVarRoot,
  serviceLibRoot,
  serviceLogRoot,
  serviceSrvRoot,
  tenantRoot,
  appRoot,
  serviceExtensionsRoot,
  user,
  group
};

Object.freeze(module.exports);
