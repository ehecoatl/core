#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

APP_NAME="${1:-}"
[ -n "$APP_NAME" ] || {
  echo "Usage: ehecoatl tenant [@<domain>] deploy app <app_name> -a <app_kit>"
  echo
  echo "Deploys one app into the selected tenant from an app kit folder or .zip file."
  echo "Missing kits are looked up in built-in kits, custom extension kits, then"
  echo "https://github.com/ehecoatl/app-kit-<name>.git."
  echo
  echo "Options:"
  echo "  -a, --app-kit <name>   App kit folder or .zip name to copy/extract."
  echo "                         The .zip extension is optional."
  echo "                         Zip kits must contain files directly at the zip root."
  echo "                         Missing kits may be cloned into custom app kits"
  echo "                         from ehecoatl/app-kit-<name>."
  echo "  -h, --help             Show this help message."
  exit 1
}
[ "$APP_NAME" != "-h" ] && [ "$APP_NAME" != "--help" ] || {
  echo "Usage: ehecoatl tenant [@<domain>] deploy app <app_name> -a <app_kit>"
  echo
  echo "Deploys one app into the selected tenant from an app kit folder or .zip file."
  echo "Missing kits are looked up in built-in kits, custom extension kits, then"
  echo "https://github.com/ehecoatl/app-kit-<name>.git."
  echo
  echo "Options:"
  echo "  -a, --app-kit <name>   App kit folder or .zip name to copy/extract."
  echo "                         The .zip extension is optional."
  echo "                         Zip kits must contain files directly at the zip root."
  echo "                         Missing kits may be cloned into custom app kits"
  echo "                         from ehecoatl/app-kit-<name>."
  echo "  -h, --help             Show this help message."
  exit 0
}
shift || true

TENANT_JSON="$(resolve_tenant_scope_target_json)"
TENANT_ID="$(json_field "$TENANT_JSON" tenantId)"
[ -n "$TENANT_ID" ] || {
  echo "No tenant target could be resolved from the current directory or explicit @<domain>."
  exit 1
}

exec "$SCRIPT_DIR/../shared/deploy.sh" app "${APP_NAME}@${TENANT_ID}" "$@"
