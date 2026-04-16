#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

APP_NAME="${1:-}"
[ -n "$APP_NAME" ] || {
  echo "Usage: ehecoatl tenant delete app <app_name>"
  exit 1
}

TENANT_JSON="$(resolve_tenant_scope_target_json)"
TENANT_ID="$(json_field "$TENANT_JSON" tenantId)"
[ -n "$TENANT_ID" ] || {
  echo "No tenant scope could be derived from the current directory."
  exit 1
}

exec "$SCRIPT_DIR/../shared/delete.sh" app "${APP_NAME}@${TENANT_ID}"
