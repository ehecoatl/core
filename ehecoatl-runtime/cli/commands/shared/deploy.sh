#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

DEPLOY_SCOPE="${1:-}"
[ "$#" -gt 0 ] && shift || true

TENANT_KIT_NAME=""
APP_KIT_NAME=""
REPO_URL=""
TARGET_ALIAS=""

VAR_BASE_DIR="$TENANTS_BASE"
TENANT_LAYOUT_CLI="$SCRIPT_DIR/../../lib/tenant-layout-cli.js"
CONTRACT_IDENTITY_CLI="$SCRIPT_DIR/../../lib/contract-identity-cli.js"
CLI_SPEC_CLI="$SCRIPT_DIR/../../lib/cli-spec-cli.js"
TENANT_KITS_BASE="$SCRIPT_DIR/../../../extensions/tenant-kits"
APP_KITS_BASE="$SCRIPT_DIR/../../../extensions/app-kits"
DEFAULT_TENANT_KIT_NAME="empty-tenant"
DEFAULT_APP_KIT_NAME="empty-app"
usage() {
  cat <<'EOF_USAGE'
Internal shared deploy helper:
  deploy.sh tenant @<domain> [--repo <repo_url>] [-t <tenant_kit>]
  deploy.sh app <app_name>@<domain> [--repo <repo_url>] [-a <app_kit>]
  deploy.sh app <app_name>@<tenant_id> [--repo <repo_url>] [-a <app_kit>]
EOF_USAGE
}

normalize_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

json_field() {
  node -e '
    const data = JSON.parse(process.argv[1]);
    const key = process.argv[2];
    const value = data?.[key];
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  ' "$1" "$2"
}

set_owner_group_mode() {
  local target_path="$1"
  local owner_name="$2"
  local group_name="$3"
  local mode_value="$4"

  [ -e "$target_path" ] || return 0
  sudo chown "$owner_name:$group_name" "$target_path"
  sudo chmod "$mode_value" "$target_path"
}

apply_tree_mode() {
  local root_path="$1"
  local owner_name="$2"
  local group_name="$3"
  local dir_mode="$4"
  local file_mode="$5"

  [ -d "$root_path" ] || return 0
  sudo chown -R "$owner_name:$group_name" "$root_path"
  sudo find "$root_path" -type d -exec chmod "$dir_mode" {} +
  sudo find "$root_path" -type f -exec chmod "$file_mode" {} +
}

make_tree_public_readable() {
  local root_path="$1"
  local dir_mode="${2:-2755}"
  local file_mode="${3:-0644}"

  [ -d "$root_path" ] || return 0
  sudo find "$root_path" -type d -exec chmod "$dir_mode" {} +
  sudo find "$root_path" -type f -exec chmod "$file_mode" {} +
}

apply_contract_tree_mode() {
  local root_path="$1"
  local contract_json="$2"
  local mode_value file_mode recursive_flag owner_name group_name path_type

  [ -e "$root_path" ] || return 0
  mode_value="$(json_field "$contract_json" mode 2>/dev/null || true)"
  recursive_flag="$(json_field "$contract_json" recursive 2>/dev/null || true)"
  owner_name="$(json_field "$contract_json" owner 2>/dev/null || true)"
  group_name="$(json_field "$contract_json" group 2>/dev/null || true)"
  path_type="$(json_field "$contract_json" type 2>/dev/null || true)"
  [ -n "$mode_value" ] || return 0

  if [ "$path_type" = "file" ] || [ -f "$root_path" ]; then
    file_mode="$(dir_mode_to_file_mode "$mode_value")"
    if [ -n "$owner_name" ] && [ -n "$group_name" ]; then
      sudo chown "$owner_name:$group_name" "$root_path"
    fi
    sudo chmod "$file_mode" "$root_path"
    return 0
  fi

  file_mode="$(dir_mode_to_file_mode "$mode_value")"

  if [ "$recursive_flag" = "true" ]; then
    if [ -n "$owner_name" ] && [ -n "$group_name" ]; then
      sudo chown -R "$owner_name:$group_name" "$root_path"
    fi
    make_tree_public_readable "$root_path" "$mode_value" "$file_mode"
    return 0
  fi

  if [ -z "$owner_name" ]; then
    owner_name="$(sudo stat -c '%U' "$root_path")"
  fi
  if [ -z "$group_name" ]; then
    group_name="$(sudo stat -c '%G' "$root_path")"
  fi
  set_owner_group_mode "$root_path" "$owner_name" "$group_name" "$mode_value"
}

apply_app_permissions() {
  local app_dir="$1"
  local owner_user="$2"
  local owner_group="$3"
  local tenant_id="$4"
  local app_id="$5"
  local system_dir="$app_dir/.ehecoatl"
  local asset_static_json asset_static_dir asset_static_mode asset_static_file_mode
  local config_json routes_json config_dir routes_dir

  asset_static_json="$(resolve_contract_path_entry appScope RESOURCES assetStatic "$tenant_id" "$app_id" || true)"
  asset_static_dir="$(json_field "$asset_static_json" path 2>/dev/null || true)"
  asset_static_mode="$(json_field "$asset_static_json" mode 2>/dev/null || true)"
  [ -n "$asset_static_mode" ] || asset_static_mode="2775"
  asset_static_file_mode="$(dir_mode_to_file_mode "$asset_static_mode")"
  config_json="$(resolve_contract_path_entry appScope OVERRIDES config "$tenant_id" "$app_id" || true)"
  routes_json="$(resolve_contract_path_entry appScope OVERRIDES routes "$tenant_id" "$app_id" || true)"
  config_dir="$(json_field "$config_json" path 2>/dev/null || true)"
  routes_dir="$(json_field "$routes_json" path 2>/dev/null || true)"

  apply_tree_mode "$app_dir" "$owner_user" "$owner_group" "2770" "0660"
  set_owner_group_mode "$app_dir" "$owner_user" "$owner_group" "2751"
  [ -d "$app_dir/assets" ] && set_owner_group_mode "$app_dir/assets" "$owner_user" "$owner_group" "2751"
  [ -d "$system_dir" ] && set_owner_group_mode "$system_dir" "$owner_user" "$owner_group" "2770"
  [ -d "$system_dir/.cache" ] && set_owner_group_mode "$system_dir/.cache" "$owner_user" "$owner_group" "2770"
  [ -d "$system_dir/.log" ] && set_owner_group_mode "$system_dir/.log" "$owner_user" "$owner_group" "2770"
  [ -d "$system_dir/.spool" ] && set_owner_group_mode "$system_dir/.spool" "$owner_user" "$owner_group" "2770"
  [ -d "$system_dir/.backups" ] && set_owner_group_mode "$system_dir/.backups" "$owner_user" "$owner_group" "2770"
  apply_contract_tree_mode "$asset_static_dir" "$asset_static_json"
  apply_contract_tree_mode "$config_dir" "$config_json"
  apply_contract_tree_mode "$routes_dir" "$routes_json"
  return 0
}

apply_tenant_permissions() {
  local tenant_dir="$1"
  local owner_user="$2"
  local owner_group="$3"
  local tenant_id="$4"
  local tenant_runtime_root_json tenant_runtime_root_path
  local tenant_runtime_lib_json tenant_runtime_lib_path
  local tenant_runtime_ssl_json tenant_runtime_ssl_path
  local tenant_runtime_backups_json tenant_runtime_backups_path
  local tenant_config_json tenant_config_path
  local asset_static_json shared_assets_static_dir
  local config_json routes_json config_dir routes_dir shared_dir
  local tenant_subpath

  tenant_runtime_root_json="$(resolve_contract_path_entry tenantScope RUNTIME root "$tenant_id" || true)"
  tenant_runtime_root_path="$(json_field "$tenant_runtime_root_json" path 2>/dev/null || true)"
  tenant_runtime_lib_json="$(resolve_contract_path_entry tenantScope RUNTIME lib "$tenant_id" || true)"
  tenant_runtime_lib_path="$(json_field "$tenant_runtime_lib_json" path 2>/dev/null || true)"
  tenant_runtime_ssl_json="$(resolve_contract_path_entry tenantScope RUNTIME ssl "$tenant_id" || true)"
  tenant_runtime_ssl_path="$(json_field "$tenant_runtime_ssl_json" path 2>/dev/null || true)"
  tenant_runtime_backups_json="$(resolve_contract_path_entry tenantScope RUNTIME backups "$tenant_id" || true)"
  tenant_runtime_backups_path="$(json_field "$tenant_runtime_backups_json" path 2>/dev/null || true)"
  tenant_config_json="$(resolve_contract_path_entry tenantScope RUNTIME config "$tenant_id" || true)"
  tenant_config_path="$(json_field "$tenant_config_json" path 2>/dev/null || true)"
  asset_static_json="$(resolve_contract_path_entry tenantScope SHARED assetStatic "$tenant_id" || true)"
  shared_assets_static_dir="$(json_field "$asset_static_json" path 2>/dev/null || true)"
  config_json="$(resolve_contract_path_entry tenantScope OVERRIDES config "$tenant_id" || true)"
  routes_json="$(resolve_contract_path_entry tenantScope OVERRIDES routes "$tenant_id" || true)"
  config_dir="$(json_field "$config_json" path 2>/dev/null || true)"
  routes_dir="$(json_field "$routes_json" path 2>/dev/null || true)"
  shared_dir="$(resolve_json_field "$(resolve_contract_path_entry tenantScope SHARED root "$tenant_id")" path)"

  [ -d "$tenant_dir" ] || return 0
  sudo chown "$owner_user:$owner_group" "$tenant_dir"
  set_owner_group_mode "$tenant_dir" "$owner_user" "$owner_group" "2755"
  while IFS= read -r tenant_subpath; do
    [ -n "$tenant_subpath" ] || continue
    [ "$tenant_subpath" = "$shared_dir" ] && continue
    sudo chown -R "$owner_user:$owner_group" "$tenant_subpath"
    sudo find "$tenant_subpath" -type d -exec chmod 2770 {} +
    sudo find "$tenant_subpath" -type f -exec chmod 0660 {} +
  done < <(sudo find "$tenant_dir" -mindepth 1 -maxdepth 1 \
    ! -name 'app_*' \
    ! -name 'shared' \
    -print)
  if [ -d "$shared_dir" ]; then
    apply_tree_mode "$shared_dir" "$owner_user" "$owner_group" "2750" "0640"
    set_owner_group_mode "$shared_dir" "$owner_user" "$owner_group" "2751"
    [ -d "$shared_dir/assets" ] && set_owner_group_mode "$shared_dir/assets" "$owner_user" "$owner_group" "2751"
  fi
  apply_contract_tree_mode "$tenant_runtime_root_path" "$tenant_runtime_root_json"
  apply_contract_tree_mode "$tenant_runtime_lib_path" "$tenant_runtime_lib_json"
  apply_contract_tree_mode "$tenant_runtime_ssl_path" "$tenant_runtime_ssl_json"
  apply_contract_tree_mode "$tenant_runtime_backups_path" "$tenant_runtime_backups_json"
  apply_contract_tree_mode "$tenant_config_path" "$tenant_config_json"
  apply_contract_tree_mode "$shared_assets_static_dir" "$asset_static_json"
  apply_contract_tree_mode "$config_dir" "$config_json"
  apply_contract_tree_mode "$routes_dir" "$routes_json"
  return 0
}

resolve_json_field() {
  local json_payload="$1"
  local field_path="$2"
  json_field "$json_payload" "$field_path"
}

resolve_contract_path_entry() {
  local layer_key="$1"
  local category_key="$2"
  local item_key="$3"
  local tenant_id="${4:-}"
  local app_id="${5:-}"

  node "$CONTRACT_IDENTITY_CLI" path-entry "$layer_key" "$category_key" "$item_key" "$tenant_id" "$app_id"
}

dir_mode_to_file_mode() {
  local dir_mode="${1:-2775}"
  local mode_digits="${dir_mode: -3}"
  local owner=$(( (8#${mode_digits:0:1}) & 6 ))
  local group=$(( (8#${mode_digits:1:1}) & 6 ))
  local other=$(( (8#${mode_digits:2:1}) & 6 ))
  printf '0%01o%01o%01o' "$owner" "$group" "$other"
}

ensure_kit_exists() {
  local kit_path="$1"
  local description="$2"
  [ -d "$kit_path" ] || {
    echo "${description} not found: $kit_path"
    exit 1
  }
}

resolve_tenant_template_dir() {
  local selected_kit_name="${TENANT_KIT_NAME:-$DEFAULT_TENANT_KIT_NAME}"
  local template_dir="$TENANT_KITS_BASE/$selected_kit_name"
  ensure_kit_exists "$template_dir" "Tenant template"
  printf '%s' "$template_dir"
}

resolve_app_template_dir() {
  local selected_kit_name="${APP_KIT_NAME:-$DEFAULT_APP_KIT_NAME}"
  local template_dir="$APP_KITS_BASE/$selected_kit_name"
  ensure_kit_exists "$template_dir" "App template"
  printf '%s' "$template_dir"
}

create_tenant_shell_identity() {
  local tenant_user="$1"
  local tenant_group="$2"

  if ! getent group "$tenant_group" >/dev/null 2>&1; then
    sudo groupadd --system "$tenant_group"
  fi

  if ! id "$tenant_user" >/dev/null 2>&1; then
    sudo useradd --system \
      --gid "$tenant_group" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "$tenant_user"
  fi

  getent group "$tenant_group" >/dev/null 2>&1 || {
    echo "Failed to materialize tenant group '$tenant_group'."
    exit 1
  }
  id "$tenant_user" >/dev/null 2>&1 || {
    echo "Failed to materialize tenant user '$tenant_user'."
    exit 1
  }
}

create_app_shell_identity() {
  local app_user="$1"
  local app_group="$2"

  if ! getent group "$app_group" >/dev/null 2>&1; then
    sudo groupadd --system "$app_group"
  fi

  if ! id "$app_user" >/dev/null 2>&1; then
    sudo useradd --system \
      --gid "$app_group" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "$app_user"
  fi

  getent group "$app_group" >/dev/null 2>&1 || {
    echo "Failed to materialize app group '$app_group'."
    exit 1
  }
  id "$app_user" >/dev/null 2>&1 || {
    echo "Failed to materialize app user '$app_user'."
    exit 1
  }
}

parse_deploy_scope() {
  DEPLOY_SCOPE="$(normalize_lower "$DEPLOY_SCOPE")"
  case "$DEPLOY_SCOPE" in
    -h|--help)
      usage
      exit 0
      ;;
    tenant|app) ;;
    *)
      usage
      exit 1
      ;;
  esac
}

parse_args() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -t|--tenant-kit)
        TENANT_KIT_NAME="${2:-}"
        [ -n "$TENANT_KIT_NAME" ] || { echo "Missing value for $1"; exit 1; }
        shift 2
        ;;
      -a|--app-kit)
        APP_KIT_NAME="${2:-}"
        [ -n "$APP_KIT_NAME" ] || { echo "Missing value for $1"; exit 1; }
        shift 2
        ;;
      --repo)
        REPO_URL="${2:-}"
        [ -n "$REPO_URL" ] || { echo "Missing value for $1"; exit 1; }
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        if [ -z "$TARGET_ALIAS" ]; then
          TARGET_ALIAS="$1"
        else
          echo "Unknown argument: $1"
          exit 1
        fi
        shift
        ;;
    esac
  done
}

run_after_cli_commands() {
  local scope_name="$1"
  local command_name="$2"
  local tenant_id="${3:-}"
  local app_id="${4:-}"
  local tenant_domain="${5:-}"
  local app_name="${6:-}"

  local vars_json
  vars_json="$(node -e '
    const payload = {
      tenant_id: process.argv[1] || null,
      app_id: process.argv[2] || null,
      tenant_domain: process.argv[3] || null,
      app_name: process.argv[4] || null
    };
    process.stdout.write(JSON.stringify(payload));
  ' "$tenant_id" "$app_id" "$tenant_domain" "$app_name")"

  local command_json
  command_json="$(node "$CLI_SPEC_CLI" after-cli "$scope_name" "$command_name" "$vars_json")"

  local command_count
  command_count="$(node -e 'const data = JSON.parse(process.argv[1] || `[]`); process.stdout.write(String(data.length));' "$command_json")"
  [ "$command_count" -gt 0 ] || return 0

  node -e 'const data = JSON.parse(process.argv[1] || `[]`); for (const cmd of data) console.log(cmd);' "$command_json" \
    | while IFS= read -r command; do
      [ -n "$command" ] || continue
      if [ "$(id -u)" -eq 0 ]; then
        bash -lc "$command"
      else
        sudo bash -lc "$command"
      fi
    done
}

deploy_tenant() {
  [ -n "$TARGET_ALIAS" ] || { usage; exit 1; }
  [ -n "$TENANT_KIT_NAME" ] || [ -n "$REPO_URL" ] || { echo "deploy tenant requires -t|--tenant-kit and/or --repo"; exit 1; }
  [ -z "$APP_KIT_NAME" ] || { echo "deploy tenant does not accept -a|--app-kit"; exit 1; }

  local normalized_target tenant_domain tenant_id tenant_dir tenant_user tenant_group tenant_owner tenant_owner_group tenant_shell_json tenant_fs_json tenant_kit_dir existing_tenant_json selected_tenant_kit_name
  normalized_target="$(normalize_lower "$TARGET_ALIAS")"
  if [[ ! "$normalized_target" =~ ^@([a-z0-9.-]+)$ ]]; then
    echo "deploy tenant requires target shape @<domain>"
    usage
    exit 1
  fi

  tenant_domain="${BASH_REMATCH[1]}"
  tenant_kit_dir="$(resolve_tenant_template_dir)"
  selected_tenant_kit_name="$(basename "$tenant_kit_dir")"

  existing_tenant_json="$(node "$TENANT_LAYOUT_CLI" find-tenant-json-by-domain "$VAR_BASE_DIR" "$tenant_domain" || true)"
  if [ -n "${existing_tenant_json:-}" ] && [ "$existing_tenant_json" != "null" ]; then
    echo "Tenant '$tenant_domain' already exists."
    exit 1
  fi

  tenant_id="$(node "$TENANT_LAYOUT_CLI" generate-unique-id tenant_ "$VAR_BASE_DIR")"
  tenant_dir="$VAR_BASE_DIR/tenant_${tenant_id}"
  tenant_shell_json="$(node "$CONTRACT_IDENTITY_CLI" shell-identity tenantScope "$tenant_id")"
  tenant_fs_json="$(node "$CONTRACT_IDENTITY_CLI" tenant-filesystem "$tenant_id")"
  tenant_user="$(resolve_json_field "$tenant_shell_json" user)"
  tenant_group="$(resolve_json_field "$tenant_shell_json" group)"
  tenant_owner="$(resolve_json_field "$tenant_fs_json" owner)"
  tenant_owner_group="$(resolve_json_field "$tenant_fs_json" group)"

  echo "Deploying tenant:"
  echo "  Target: $TARGET_ALIAS"
  echo "  Tenant kit: $selected_tenant_kit_name"
  [ -n "$REPO_URL" ] && echo "  Repo:   $REPO_URL"
  echo "  Domain: $tenant_domain"
  echo "  Tenant: tenant_${tenant_id}"
  echo "  User:   $tenant_user"
  echo "  Group:  $tenant_group"

  create_tenant_shell_identity "$tenant_user" "$tenant_group"

  sudo mkdir -pv "$tenant_dir"
  sudo cp -R "$tenant_kit_dir/." "$tenant_dir/"
  [ -f "$tenant_dir/config.json" ] || echo '{}' | sudo tee "$tenant_dir/config.json" >/dev/null
  sudo node "$TENANT_LAYOUT_CLI" patch-tenant-config "$tenant_dir/config.json" "$tenant_id" "$tenant_domain" "$REPO_URL" >/dev/null

  apply_tenant_permissions "$tenant_dir" "$tenant_owner" "$tenant_owner_group" "$tenant_id"
  run_after_cli_commands "core" "deploy tenant" "$tenant_id" "" "$tenant_domain" ""

  echo "Tenant '$TARGET_ALIAS' deployed successfully."
}

deploy_app() {
  [ -n "$TARGET_ALIAS" ] || { usage; exit 1; }
  [ -n "$APP_KIT_NAME" ] || [ -n "$REPO_URL" ] || { echo "deploy app requires -a|--app-kit and/or --repo"; exit 1; }
  [ -z "$TENANT_KIT_NAME" ] || { echo "deploy app does not accept -t|--tenant-kit"; exit 1; }

  local normalized_target target_app_name target_domain target_tenant_id target_mode tenant_json tenant_dir tenant_id tenant_fs_json tenant_owner tenant_owner_group app_json app_id app_dir app_user app_group app_owner app_owner_group app_shell_json app_fs_json app_kit_dir tenant_host selected_app_kit_name
  normalized_target="$(normalize_lower "$TARGET_ALIAS")"

  if [[ "$normalized_target" =~ ^([a-z0-9._-]+)@([a-z0-9]{12})$ ]]; then
    target_mode="tenant_id"
    target_app_name="${BASH_REMATCH[1]}"
    target_tenant_id="${BASH_REMATCH[2]}"
  elif [[ "$normalized_target" =~ ^([a-z0-9._-]+)@([a-z0-9.-]+)$ ]]; then
    target_mode="domain"
    target_app_name="${BASH_REMATCH[1]}"
    target_domain="${BASH_REMATCH[2]}"
  else
    echo "deploy app requires target shape <app_name>@<domain> or <app_name>@<tenant_id>"
    usage
    exit 1
  fi

  app_kit_dir="$(resolve_app_template_dir)"
  selected_app_kit_name="$(basename "$app_kit_dir")"

  if [ "$target_mode" = "tenant_id" ]; then
    tenant_json="$(node "$TENANT_LAYOUT_CLI" find-tenant-json-by-id "$VAR_BASE_DIR" "$target_tenant_id" || true)"
    [ -n "${tenant_json:-}" ] && [ "$tenant_json" != "null" ] || {
      echo "Tenant '$target_tenant_id' not found."
      exit 1
    }
    tenant_id="$(json_field "$tenant_json" tenantId)"
    target_domain="$(json_field "$tenant_json" tenantDomain)"
    tenant_dir="$(json_field "$tenant_json" tenantRoot)"
    app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-tenant-id-and-app-name "$VAR_BASE_DIR" "$tenant_id" "$target_app_name" || true)"
  else
    tenant_json="$(node "$TENANT_LAYOUT_CLI" find-tenant-json-by-domain "$VAR_BASE_DIR" "$target_domain" || true)"
    [ -n "${tenant_json:-}" ] && [ "$tenant_json" != "null" ] || {
      echo "Tenant '$target_domain' not found. Deploy the tenant first."
      exit 1
    }
    tenant_id="$(json_field "$tenant_json" tenantId)"
    tenant_dir="$(json_field "$tenant_json" tenantRoot)"
    app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-domain-and-app-name "$VAR_BASE_DIR" "$target_domain" "$target_app_name" || true)"
  fi

  if [ -n "${app_json:-}" ] && [ "$app_json" != "null" ]; then
    echo "App '$target_app_name' already exists in target '$TARGET_ALIAS'."
    exit 1
  fi

  app_id="$(node "$TENANT_LAYOUT_CLI" generate-unique-id app_ "$tenant_dir")"
  app_dir="$tenant_dir/app_${app_id}"
  tenant_fs_json="$(node "$CONTRACT_IDENTITY_CLI" tenant-filesystem "$tenant_id")"
  tenant_owner="$(resolve_json_field "$tenant_fs_json" owner)"
  tenant_owner_group="$(resolve_json_field "$tenant_fs_json" group)"
  app_shell_json="$(node "$CONTRACT_IDENTITY_CLI" shell-identity appScope "$tenant_id" "$app_id")"
  app_fs_json="$(node "$CONTRACT_IDENTITY_CLI" app-filesystem "$tenant_id" "$app_id")"
  app_user="$(resolve_json_field "$app_shell_json" user)"
  app_group="$(resolve_json_field "$app_shell_json" group)"
  app_owner="$(resolve_json_field "$app_fs_json" owner)"
  app_owner_group="$(resolve_json_field "$app_fs_json" group)"
  tenant_host="${target_app_name}.${target_domain}"

  echo "Deploying app:"
  echo "  Target: $TARGET_ALIAS"
  echo "  App kit: $selected_app_kit_name"
  [ -n "$REPO_URL" ] && echo "  Repo:    $REPO_URL"
  echo "  Domain:  $target_domain"
  echo "  Tenant:  tenant_${tenant_id}"
  echo "  App:     $target_app_name"
  echo "  AppId:   app_${app_id}"
  echo "  Route:   $tenant_host"
  echo "  User:    $app_user"
  echo "  Group:   $app_group"

  create_app_shell_identity "$app_user" "$app_group"

  sudo mkdir -pv "$app_dir"
  sudo cp -R "$app_kit_dir/." "$app_dir/"
  sudo mkdir -p "$app_dir/config"
  if [ ! -f "$app_dir/config/app.json" ]; then
    echo '{}' | sudo tee "$app_dir/config/app.json" >/dev/null
  fi
  sudo node "$TENANT_LAYOUT_CLI" patch-app-config "$app_dir/config/app.json" "$app_id" "$target_app_name" "$REPO_URL" >/dev/null

  apply_app_permissions "$app_dir" "$app_owner" "$app_owner_group" "$tenant_id" "$app_id"
  apply_tenant_permissions "$tenant_dir" "$tenant_owner" "$tenant_owner_group" "$tenant_id"
  run_after_cli_commands "tenant" "deploy app" "$tenant_id" "$app_id" "$target_domain" "$target_app_name"

  echo "App '$TARGET_ALIAS' deployed successfully."
}

parse_deploy_scope
parse_args "$@"

case "$DEPLOY_SCOPE" in
  tenant) deploy_tenant ;;
  app) deploy_app ;;
esac
