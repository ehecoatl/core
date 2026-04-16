#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
source "$SCRIPT_DIR/../../lib/runtime-policy.sh"
policy_init "$0"

USER_NAME="${1:-}"
PROXY_PORT="${2:-}"
TENANTS_BASE="$(policy_value 'paths.tenantsBase')"
VAR_BASE_DIR="$(policy_value 'paths.varBase')"
DEFAULT_GROUP="$(policy_value 'system.sharedGroup')"
APP_MODE="$(policy_value 'tenantLayout.appMode')"
APP_WRITABLE_DIR_MODE="$(policy_value 'tenantLayout.appWritableDirMode')"
APP_FILE_MODE="$(policy_value 'tenantLayout.appFileMode')"
APP_CONFIG_MODE="$(policy_value 'tenantLayout.appConfigMode')"
DIRECTOR_USER="$(policy_value 'processUsers.director.user')"
TRANSPORT_USER="$(policy_value 'processUsers.transport.user')"
TENANT_LAYOUT_CLI="$SCRIPT_DIR/../../lib/tenant-layout-cli.js"

if [ -z "$USER_NAME" ] || [ -z "$PROXY_PORT" ]; then
  echo "Usage: ehecoatl proxy_setup <user> <proxy-port>"
  exit 1
fi

if ! [[ "$PROXY_PORT" =~ ^[0-9]+$ ]] || [ "$PROXY_PORT" -lt 1 ] || [ "$PROXY_PORT" -gt 65535 ]; then
  echo "Invalid proxy port: $PROXY_PORT"
  exit 1
fi

CHAIN_SUFFIX="$(printf '%s' "$USER_NAME" | tr '[:lower:].-' '[:upper:]__' | tr -cd 'A-Z0-9_')"
FILTER_CHAIN="EHECOATL_PROXY_FILTER_${CHAIN_SUFFIX}"
NAT_CHAIN="EHECOATL_PROXY_NAT_${CHAIN_SUFFIX}"

log() {
  printf '[PROXY_SETUP] %s\n' "$1"
}

run_rule() {
  "$@" >/dev/null 2>&1 || true
}

set_owner_group_mode() {
  local target_path="$1"
  local owner_name="$2"
  local group_name="$3"
  local mode_value="$4"

  [ -e "$target_path" ] || return 0
  sudo chown "$owner_name:$group_name" "$target_path" >/dev/null 2>&1
  sudo chmod "$mode_value" "$target_path" >/dev/null 2>&1
}

apply_app_permissions() {
  local app_dir="$1"
  local owner_name="$2"
  local system_dir="$app_dir/.ehecoatl"

  [ -d "$app_dir" ] || return 0
  sudo chown -R "$owner_name:$DEFAULT_GROUP" "$app_dir" >/dev/null 2>&1
  sudo find "$app_dir" -type d -exec chmod "$APP_MODE" {} + >/dev/null 2>&1
  sudo find "$app_dir" -type f -exec chmod "$APP_FILE_MODE" {} + >/dev/null 2>&1
  set_owner_group_mode "$system_dir" "$owner_name" "$DEFAULT_GROUP" "$APP_MODE"
  set_owner_group_mode "$system_dir/.cache" "$owner_name" "$DEFAULT_GROUP" "$APP_WRITABLE_DIR_MODE"
  set_owner_group_mode "$system_dir/.log" "$owner_name" "$DEFAULT_GROUP" "$APP_WRITABLE_DIR_MODE"
  set_owner_group_mode "$system_dir/.spool" "$owner_name" "$DEFAULT_GROUP" "$APP_WRITABLE_DIR_MODE"
  set_owner_group_mode "$system_dir/.backups" "$owner_name" "$DEFAULT_GROUP" "$APP_WRITABLE_DIR_MODE"
  set_owner_group_mode "$app_dir/config.json" "$owner_name" "$DEFAULT_GROUP" "$APP_CONFIG_MODE"
}

ensure_user_group() {
  if ! getent group "$USER_NAME" >/dev/null 2>&1; then
    sudo groupadd --system "$USER_NAME" >/dev/null 2>&1
  fi

  if id "$USER_NAME" >/dev/null 2>&1; then
    return 0
  fi

  if getent group "$DEFAULT_GROUP" >/dev/null 2>&1; then
    sudo useradd --system \
      --gid "$USER_NAME" \
      --groups "$DEFAULT_GROUP" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "$USER_NAME" >/dev/null 2>&1
  else
    sudo useradd --system \
      --gid "$USER_NAME" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "$USER_NAME" >/dev/null 2>&1
  fi
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

grant_user_access() {
  local matched_app_json tenant_app_dir tenant_domain_dir
  matched_app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-process-user "$TENANTS_BASE" "$USER_NAME" || true)"
  if [ -n "${matched_app_json:-}" ] && [ "$matched_app_json" != "null" ]; then
    tenant_app_dir="$(json_field "$matched_app_json" appRoot)"
    tenant_domain_dir="$(json_field "$matched_app_json" tenantRoot)"

    if [ -d "$tenant_app_dir" ]; then
      apply_app_permissions "$tenant_app_dir" "$USER_NAME"
      grant_tenant_runtime_traversal "$USER_NAME" "$tenant_domain_dir"
      apply_role_acl "$tenant_app_dir" "$DIRECTOR_USER" "tenantAccess.director"
      apply_role_acl "$tenant_app_dir" "$TRANSPORT_USER" "tenantAccess.transport"
    fi
    return 0
  fi

  for path in "/var/opt/ehecoatl" "/srv/opt/ehecoatl" "/etc/opt/ehecoatl"; do
    if [ -d "$path" ]; then
      sudo chmod -R g+rwX "$path" >/dev/null 2>&1 || true
    fi
  done
}

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
  local tenant_app_dir="$1"
  local user_name="$2"
  local target_path="$3"
  local current_dir

  [ -d "$tenant_app_dir" ] || return 0

  ensure_directory_search_permission "$tenant_app_dir" "$user_name"

  if [ -d "$target_path" ]; then
    current_dir="$target_path"
  else
    current_dir="$(dirname "$target_path")"
  fi

  while [ "$current_dir" != "$tenant_app_dir" ] && [ "$current_dir" != "/" ]; do
    case "$current_dir" in
      "$tenant_app_dir"/*)
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

  ensure_directory_search_permission "$VAR_BASE_DIR" "$tenant_user"
  ensure_directory_search_permission "$TENANTS_BASE" "$tenant_user"
  ensure_directory_search_permission "$tenant_domain_dir" "$tenant_user"
}

apply_role_acl() {
  local tenant_app_dir="$1"
  local role_user="$2"
  local role_path="$3"
  local relative_path absolute_path

  [ -n "$role_user" ] || return 0

  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    absolute_path="$tenant_app_dir/$relative_path"
    grant_path_traversal "$tenant_app_dir" "$role_user" "$absolute_path"
    apply_acl_permission "$absolute_path" "$role_user" "rX"
  done < <(policy_array_lines "$role_path.read" 2>/dev/null || true)

  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    absolute_path="$tenant_app_dir/$relative_path"
    grant_path_traversal "$tenant_app_dir" "$role_user" "$absolute_path"
    apply_acl_permission "$absolute_path" "$role_user" "rwX"
  done < <(policy_array_lines "$role_path.write" 2>/dev/null || true)
}

log "Configuring outbound proxy rules for user '$USER_NAME' on port $PROXY_PORT"
ensure_user_group
grant_user_access

run_rule sudo iptables -t filter -D OUTPUT -m owner --uid-owner "$USER_NAME" -j "$FILTER_CHAIN"
run_rule sudo iptables -t nat -D OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" --dport 443 -j "$NAT_CHAIN"

run_rule sudo iptables -t filter -F "$FILTER_CHAIN"
run_rule sudo iptables -t filter -X "$FILTER_CHAIN"
run_rule sudo iptables -t nat -F "$NAT_CHAIN"
run_rule sudo iptables -t nat -X "$NAT_CHAIN"

sudo iptables -t filter -N "$FILTER_CHAIN"
sudo iptables -t nat -N "$NAT_CHAIN"

sudo iptables -t nat -A "$NAT_CHAIN" -p tcp --dport 443 -j REDIRECT --to-ports "$PROXY_PORT"

sudo iptables -t filter -A "$FILTER_CHAIN" -o lo -j ACCEPT
sudo iptables -t filter -A "$FILTER_CHAIN" -p tcp -d 127.0.0.1 --dport "$PROXY_PORT" -j ACCEPT
sudo iptables -t filter -A "$FILTER_CHAIN" -p tcp -d 127.0.0.1 --sport "$PROXY_PORT" -j ACCEPT
sudo iptables -t filter -A "$FILTER_CHAIN" -j REJECT

sudo iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" --dport 443 -j "$NAT_CHAIN"
sudo iptables -t filter -A OUTPUT -m owner --uid-owner "$USER_NAME" -j "$FILTER_CHAIN"

log "Rules applied successfully."
