#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

COMMAND_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true
[ "$#" -eq 0 ] || { echo "enable does not accept explicit target overrides."; exit 1; }

TARGET_JSON="$(
  if [ "$COMMAND_SCOPE" = "tenant" ]; then
    resolve_tenant_scope_target_json
  else
    resolve_app_scope_target_json
  fi
)"

CONFIG_PATH="$(target_config_path "$TARGET_JSON")"
if [ "$(target_kind "$TARGET_JSON")" = "app" ]; then
  config_set_value "$CONFIG_PATH" "appEnabled" "true" >/dev/null
  echo "Enabled app at $CONFIG_PATH"
else
  config_set_value "$CONFIG_PATH" "tenantEnabled" "true" >/dev/null
  echo "Enabled tenant at $CONFIG_PATH"
fi
