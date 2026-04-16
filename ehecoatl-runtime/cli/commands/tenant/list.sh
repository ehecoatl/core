#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

TENANT_JSON="$(resolve_tenant_scope_target_json)"
TENANT_ID="$(json_field "$TENANT_JSON" tenantId)"

node -e '
  const apps = JSON.parse(process.argv[1] ?? `[]`);
  if (!Array.isArray(apps) || apps.length === 0) {
    console.log(`No apps found in the current tenant.`);
    process.exit(0);
  }
  for (const app of apps) {
    console.log(`${app.appName}\t${app.appId}\t${app.hostname ?? ``}`.trim());
  }
' "$(node "$TENANT_LAYOUT_CLI" list-apps-by-tenant-id "$TENANTS_BASE" "$TENANT_ID")"
