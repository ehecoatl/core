#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

APP_NAME="${1:-}"
[ -n "$APP_NAME" ] || {
  echo "Usage: ehecoatl tenant [@<domain>] delete app <app_name>"
  echo
  echo "Deletes one app from the selected tenant."
  echo
  echo "Options:"
  echo "  -h, --help   Show this help message."
  exit 1
}
[ "$APP_NAME" != "-h" ] && [ "$APP_NAME" != "--help" ] || {
  echo "Usage: ehecoatl tenant [@<domain>] delete app <app_name>"
  echo
  echo "Deletes one app from the selected tenant."
  echo
  echo "Options:"
  echo "  -h, --help   Show this help message."
  exit 0
}

TENANT_JSON="$(resolve_tenant_scope_target_json)"
TENANT_ID="$(json_field "$TENANT_JSON" tenantId)"
[ -n "$TENANT_ID" ] || {
  echo "No tenant target could be resolved from the current directory or explicit @<domain>."
  exit 1
}

exec "$SCRIPT_DIR/../shared/delete.sh" app "${APP_NAME}@${TENANT_ID}"
