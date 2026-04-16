#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

node -e '
  const tenants = JSON.parse(process.argv[1] ?? `[]`);
  if (!Array.isArray(tenants) || tenants.length === 0) {
    console.log(`No tenants found.`);
    process.exit(0);
  }
  for (const tenant of tenants) {
    console.log(`@${tenant.tenantDomain}\t${tenant.tenantId}\tapps:${tenant.appCount}`);
  }
' "$(node "$TENANT_LAYOUT_CLI" list-tenants "$TENANTS_BASE")"
