#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

COMMAND_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true
[ "$#" -eq 0 ] || { echo "log does not accept explicit target overrides."; exit 1; }

TARGET_JSON="$(
  if [ "$COMMAND_SCOPE" = "tenant" ]; then
    resolve_tenant_scope_target_json
  else
    resolve_app_scope_target_json
  fi
)"

if [ "$(target_kind "$TARGET_JSON")" = "app" ]; then
  APP_ROOT="$(json_field "$TARGET_JSON" appRoot)"
  mapfile -t LOG_FILES < <(find "$APP_ROOT/.ehecoatl/log" "$APP_ROOT/storage/logs" -type f 2>/dev/null | sort)
else
  TENANT_ROOT="$(json_field "$TARGET_JSON" tenantRoot)"
  mapfile -t LOG_FILES < <(find "$TENANT_ROOT/.ehecoatl/logs" -type f 2>/dev/null | sort)
fi

[ "${#LOG_FILES[@]}" -gt 0 ] || {
  echo "No log files found for the selected target."
  exit 1
}

tail_existing_logs "${LOG_FILES[@]}"
