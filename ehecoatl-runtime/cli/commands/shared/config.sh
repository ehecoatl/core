#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

COMMAND_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true
GET_KEY=""
SET_KEY=""
SET_VALUE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --get)
      GET_KEY="${2:-}"
      [ -n "$GET_KEY" ] || { echo "Missing value for $1"; exit 1; }
      shift 2
      ;;
    --set)
      SET_KEY="${2:-}"
      [ -n "$SET_KEY" ] || { echo "Missing value for $1"; exit 1; }
      shift 2
      if [ "$#" -eq 0 ]; then
        echo "--set requires a value."
        exit 1
      fi
      SET_VALUE="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

[ -z "$GET_KEY" ] || [ -z "$SET_KEY" ] || {
  echo "Use either --get or --set, not both."
  exit 1
}

TARGET_JSON="$(
  if [ "$COMMAND_SCOPE" = "tenant" ]; then
    resolve_tenant_scope_target_json
  else
    resolve_app_scope_target_json
  fi
)"
CONFIG_PATH="$(target_config_path "$TARGET_JSON")"

if [ -n "$GET_KEY" ]; then
  config_get_value "$CONFIG_PATH" "$GET_KEY"
  exit 0
fi

if [ -n "$SET_KEY" ]; then
  config_set_value "$CONFIG_PATH" "$SET_KEY" "$SET_VALUE" >/dev/null
  echo "Updated $SET_KEY in $CONFIG_PATH"
  exit 0
fi

node -e '
  const fs = require(`node:fs`);
  const filePath = process.argv[1];
  const data = JSON.parse(fs.readFileSync(filePath, `utf8`));
  process.stdout.write(JSON.stringify(data, null, 2) + `\n`);
' "$CONFIG_PATH"
