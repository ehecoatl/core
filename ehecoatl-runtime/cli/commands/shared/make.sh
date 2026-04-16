#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
RUNTIME_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EXTENSION_TEMPLATES_DIR="$RUNTIME_ROOT/config/templates/extensions"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

COMMAND_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true

RESOURCE_TYPE="${1:-}"
RESOURCE_NAME="${2:-}"
[ -n "$RESOURCE_TYPE" ] && [ -n "$RESOURCE_NAME" ] || {
  echo "Usage:"
  echo "  ehecoatl tenant make plugin <new_resource_name>"
  echo "  ehecoatl app make <middleware|plugin|action> <new_resource_name>"
  exit 1
}
shift 2

[ "$#" -eq 0 ] || { echo "make does not accept explicit target overrides."; exit 1; }

template_path_for_type() {
  case "$1" in
    plugin) printf '%s/plugin.js' "$EXTENSION_TEMPLATES_DIR" ;;
    middleware) printf '%s/middleware.js' "$EXTENSION_TEMPLATES_DIR" ;;
    action) printf '%s/action.js' "$EXTENSION_TEMPLATES_DIR" ;;
    *) return 1 ;;
  esac
}

copy_template_to_target() {
  local resource_type="$1"
  local target_file="$2"
  local template_file
  template_file="$(template_path_for_type "$resource_type")" || {
    echo "No template is configured for resource type: $resource_type"
    exit 1
  }
  [ -f "$template_file" ] || {
    echo "Missing template file: $template_file"
    exit 1
  }
  mkdir -p "$(dirname "$target_file")"
  cp "$template_file" "$target_file"
}

TARGET_JSON="$(
  if [ "$COMMAND_SCOPE" = "tenant" ]; then
    resolve_tenant_scope_target_json
  else
    resolve_app_scope_target_json
  fi
)"
TARGET_KIND="$(target_kind "$TARGET_JSON")"

if [ "$COMMAND_SCOPE" = "tenant" ] && [ "$RESOURCE_TYPE" != "plugin" ]; then
  echo "tenant make only supports plugin resources."
  exit 1
fi

case "$RESOURCE_TYPE" in
  plugin)
    if [ "$TARGET_KIND" = "app" ]; then
      TARGET_FILE="$(json_field "$TARGET_JSON" appRoot)/plugins/${RESOURCE_NAME}.js"
    else
      TARGET_FILE="$(json_field "$TARGET_JSON" tenantRoot)/shared/plugins/${RESOURCE_NAME}.js"
    fi
    copy_template_to_target plugin "$TARGET_FILE"
    ;;
  middleware)
    [ "$TARGET_KIND" = "app" ] || {
      echo "middleware generation requires an app scope working directory."
      exit 1
    }
    TARGET_FILE="$(json_field "$TARGET_JSON" appRoot)/app/http/middlewares/${RESOURCE_NAME}.js"
    copy_template_to_target middleware "$TARGET_FILE"
    ;;
  action)
    [ "$TARGET_KIND" = "app" ] || {
      echo "action generation requires an app scope working directory."
      exit 1
    }
    TARGET_FILE="$(json_field "$TARGET_JSON" appRoot)/app/http/actions/${RESOURCE_NAME}.js"
    copy_template_to_target action "$TARGET_FILE"
    ;;
  *)
    echo "Unknown resource type: $RESOURCE_TYPE"
    exit 1
    ;;
esac

echo "Created ${RESOURCE_TYPE} at $TARGET_FILE"
