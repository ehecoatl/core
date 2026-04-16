#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
source "$SCRIPT_DIR/../lib/runtime-policy.sh"
policy_init "$0"

TENANTS_BASE="$(policy_value 'paths.tenantsBase')"
TENANT_LAYOUT_CLI="$SCRIPT_DIR/../lib/tenant-layout-cli.js"
SERVICE_NAME="ehecoatl.service"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || { echo "sudo is required."; exit 1; }
  SUDO="sudo"
fi

if command -v systemctl >/dev/null 2>&1; then
  if $SUDO systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "Stop $SERVICE_NAME before running tenant_migrate_layout."
    exit 1
  fi
fi

if [ ! -d "$TENANTS_BASE" ]; then
  echo "Tenants base not found: $TENANTS_BASE"
  exit 1
fi

node "$TENANT_LAYOUT_CLI" migrate-layout "$TENANTS_BASE" | node -e '
  const summary = JSON.parse(require(`node:fs`).readFileSync(0, `utf8`));
  const migrated = Array.isArray(summary?.migrated) ? summary.migrated : [];
  console.log(`Migrated ${migrated.length} tenant(s).`);
  for (const tenant of migrated) {
    console.log(`- ${tenant.tenantDomain} -> ${tenant.tenantRoot}`);
    for (const app of tenant.apps ?? []) {
      console.log(`  * ${app.appName} -> ${app.appRoot}`);
    }
  }
'
