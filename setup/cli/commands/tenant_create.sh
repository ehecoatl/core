#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
source "$SCRIPT_DIR/../../lib/runtime-policy.sh"
policy_init "$0"

# -----------------------------
# Defaults
# -----------------------------
DEFAULT_HOST="www"
VAR_BASE_DIR="$(policy_value 'paths.tenantsBase')"
VAR_ROOT_DIR="$(policy_value 'paths.varBase')"
DEFAULT_OWNER="$(policy_value 'tenantLayout.domainBaseOwner')"
DEFAULT_GROUP="$(policy_value 'tenantLayout.domainBaseGroup')"
DOMAIN_BASE_MODE="$(policy_value 'tenantLayout.domainBaseMode')"
HOST_MODE="$(policy_value 'tenantLayout.hostMode')"
HOST_WRITABLE_DIR_MODE="$(policy_value 'tenantLayout.hostWritableDirMode')"
HOST_FILE_MODE="$(policy_value 'tenantLayout.hostFileMode')"
HOST_CONFIG_MODE="$(policy_value 'tenantLayout.hostConfigMode')"
TENANT_PREFIX="$(policy_value 'processUsers.tenant.prefix')"
MANAGER_USER="$(policy_value 'processUsers.manager.user')"
ENGINE_USER="$(policy_value 'processUsers.engine.user')"
TEMPLATE_DIR="$SCRIPT_DIR/../../templates/tenant-minimal"

# -----------------------------
# Parse Arguments
# -----------------------------
DOMAIN=""
HOST="$DEFAULT_HOST"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -host)
      HOST="$2"
      shift 2
      ;;
    *)
      if [ -z "$DOMAIN" ]; then
        DOMAIN="$1"
      else
        echo "Unknown argument: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

# -----------------------------
# Validate Input
# -----------------------------
if [ -z "$DOMAIN" ]; then
  echo "Usage: ehecatl tenant_create <domain> [-host <hostname>]"
  exit 1
fi

TENANT_HOST="${HOST}.${DOMAIN}"
TENANT_USER="${TENANT_PREFIX}${TENANT_HOST}"
TENANT_GROUP="$TENANT_USER"
TENANT_BASE="$VAR_BASE_DIR/$DOMAIN"
HOST_DIR="$TENANT_BASE/$HOST"

apply_acl_permission() {
  local target_path="$1"
  local user_name="$2"
  local permission="$3"

  if [ ! -e "$target_path" ] || ! command -v setfacl >/dev/null 2>&1; then
    return 0
  fi

  if [ -d "$target_path" ]; then
    sudo setfacl -R -m "u:${user_name}:${permission}" "$target_path" >/dev/null 2>&1 || true
    sudo setfacl -R -d -m "u:${user_name}:${permission}" "$target_path" >/dev/null 2>&1 || true
  else
    sudo setfacl -m "u:${user_name}:${permission}" "$target_path" >/dev/null 2>&1 || true
  fi
}

ensure_directory_search_permission() {
  local target_dir="$1"
  local user_name="$2"

  if [ ! -d "$target_dir" ] || ! command -v setfacl >/dev/null 2>&1; then
    return 0
  fi

  sudo setfacl -m "u:${user_name}:--x" "$target_dir" >/dev/null 2>&1 || true
}

grant_path_traversal() {
  local tenant_host_dir="$1"
  local user_name="$2"
  local target_path="$3"
  local current_dir

  [ -d "$tenant_host_dir" ] || return 0

  ensure_directory_search_permission "$tenant_host_dir" "$user_name"

  if [ -d "$target_path" ]; then
    current_dir="$target_path"
  else
    current_dir="$(dirname "$target_path")"
  fi

  while [ "$current_dir" != "$tenant_host_dir" ] && [ "$current_dir" != "/" ]; do
    case "$current_dir" in
      "$tenant_host_dir"/*)
        ensure_directory_search_permission "$current_dir" "$user_name"
        ;;
      *)
        break
        ;;
    esac
    current_dir="$(dirname "$current_dir")"
  done
}

grant_tenant_runtime_traversal() {
  local tenant_user="$1"
  local tenant_domain_dir="$2"

  ensure_directory_search_permission "$VAR_ROOT_DIR" "$tenant_user"
  ensure_directory_search_permission "$VAR_BASE_DIR" "$tenant_user"
  ensure_directory_search_permission "$tenant_domain_dir" "$tenant_user"
}

apply_role_acl() {
  local tenant_host_dir="$1"
  local role_user="$2"
  local role_path="$3"
  local relative_path absolute_path

  [ -n "$role_user" ] || return 0

  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    absolute_path="$tenant_host_dir/$relative_path"
    grant_path_traversal "$tenant_host_dir" "$role_user" "$absolute_path"
    apply_acl_permission "$absolute_path" "$role_user" "rX"
  done < <(policy_array_lines "$role_path.read" 2>/dev/null || true)

  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    absolute_path="$tenant_host_dir/$relative_path"
    grant_path_traversal "$tenant_host_dir" "$role_user" "$absolute_path"
    apply_acl_permission "$absolute_path" "$role_user" "rwX"
  done < <(policy_array_lines "$role_path.write" 2>/dev/null || true)
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

apply_host_permissions() {
  local host_dir="$1"
  local domain_dir="$2"

  set_owner_group_mode "$domain_dir" "$DEFAULT_OWNER" "$DEFAULT_GROUP" "$DOMAIN_BASE_MODE"
  apply_tree_mode "$host_dir" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_MODE" "$HOST_FILE_MODE"
  set_owner_group_mode "$host_dir/cache" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_WRITABLE_DIR_MODE"
  set_owner_group_mode "$host_dir/log" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_WRITABLE_DIR_MODE"
  set_owner_group_mode "$host_dir/spool" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_WRITABLE_DIR_MODE"
  set_owner_group_mode "$host_dir/backups" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_WRITABLE_DIR_MODE"
  set_owner_group_mode "$host_dir/src/config.json" "$TENANT_USER" "$DEFAULT_GROUP" "$HOST_CONFIG_MODE"
}

# -----------------------------
# Check Existing
# -----------------------------
if [ -d "$HOST_DIR" ]; then
  echo "Host '$HOST' already exists for domain '$DOMAIN'."
  exit 1
fi

echo "Creating tenant:"
echo "  Domain: $DOMAIN"
echo "  Host:   $HOST"
echo "  Route:  $TENANT_HOST"
echo "  User:   $TENANT_USER"

# -----------------------------
# Create User / Group
# -----------------------------
if ! getent group "$TENANT_GROUP" >/dev/null 2>&1; then
  sudo groupadd --system "$TENANT_GROUP"
fi

if ! id "$TENANT_USER" >/dev/null 2>&1; then
  sudo useradd --system \
    --gid "$TENANT_GROUP" \
    --no-create-home \
    --shell /usr/sbin/nologin \
    "$TENANT_USER"
fi

# -----------------------------
# Create Structure
# -----------------------------
sudo mkdir -pv "$TENANT_BASE"
sudo mkdir -pv "$HOST_DIR"/{backups,cache,lib,log,spool,src/{app,public/{assets/{img,js,css},lang}}}

if [ -d "$TEMPLATE_DIR/host" ]; then
  sudo cp -R "$TEMPLATE_DIR/host/." "$HOST_DIR/"
fi

# -----------------------------
# Permissions
# -----------------------------
apply_host_permissions "$HOST_DIR" "$TENANT_BASE"
grant_tenant_runtime_traversal "$TENANT_USER" "$TENANT_BASE"
apply_role_acl "$HOST_DIR" "$MANAGER_USER" "tenantAccess.manager"
apply_role_acl "$HOST_DIR" "$ENGINE_USER" "tenantAccess.engine"

echo "Tenant '$DOMAIN' with host '$HOST' created successfully."
