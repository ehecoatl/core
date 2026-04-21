#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

COMMAND_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true
[ "$#" -eq 0 ] || { echo "status does not accept explicit target overrides."; exit 1; }

TARGET_JSON="$(
  if [ "$COMMAND_SCOPE" = "tenant" ]; then
    resolve_tenant_scope_target_json
  else
    resolve_app_scope_target_json
  fi
)"
CONFIG_PATH="$(target_config_path "$TARGET_JSON")"
CONFIG_JSON="$(read_target_config "$CONFIG_PATH")"
TARGET_KIND="$(target_kind "$TARGET_JSON")"

if [ "$TARGET_KIND" = "app" ]; then
  APP_ENABLED="$(node -e 'const cfg = JSON.parse(process.argv[1]); process.stdout.write(String(cfg?.appEnabled !== false));' "$CONFIG_JSON")"
  printf 'scope=app\n'
  printf 'tenantId=%s\n' "$(json_field "$TARGET_JSON" tenantId)"
  printf 'tenantDomain=%s\n' "$(json_field "$TARGET_JSON" tenantDomain)"
  printf 'appId=%s\n' "$(json_field "$TARGET_JSON" appId)"
  printf 'appName=%s\n' "$(json_field "$TARGET_JSON" appName)"
  printf 'appRoot=%s\n' "$(json_field "$TARGET_JSON" appRoot)"
  printf 'configPath=%s\n' "$CONFIG_PATH"
  printf 'enabled=%s\n' "$APP_ENABLED"
else
  TENANT_ENABLED="$(node -e 'const cfg = JSON.parse(process.argv[1]); process.stdout.write(String(cfg?.tenantEnabled !== false));' "$CONFIG_JSON")"
  printf 'scope=tenant\n'
  printf 'tenantId=%s\n' "$(json_field "$TARGET_JSON" tenantId)"
  printf 'tenantDomain=%s\n' "$(json_field "$TARGET_JSON" tenantDomain)"
  printf 'tenantRoot=%s\n' "$(json_field "$TARGET_JSON" tenantRoot)"
  printf 'configPath=%s\n' "$CONFIG_PATH"
  printf 'enabled=%s\n' "$TENANT_ENABLED"
  printf 'appCount=%s\n' "$(node -e 'const tenant = JSON.parse(process.argv[1]); process.stdout.write(String((tenant?.apps ?? []).length));' "$TARGET_JSON")"
fi
