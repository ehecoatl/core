#!/bin/bash
set -euo pipefail

# Setup flow:
# 1. Prepare setup execution and parse installation arguments.
# 2. Validate that the project is running from the default installation directory.
# 3. Load runtime policy values and derive managed paths and runtime users.
# 4. Clean stale runtime leftovers from previous process managers or broken installs.
# 5. Install required non-Node system dependencies.
# 6. Verify that Node.js 24 with npm is already available.
# 7. Install Node.js application dependencies with npm.
# 8. Create the shared runtime group.
# 9. Create the shared runtime user.
# 10. Create the supervision scope group and auto-generated scope user.
# 11. Publish the Ehecoatl CLI symlink in /usr/local/bin.
# 12. Create the standard /var, /srv, and /etc directory layout.
# 13. Apply ownership and permission rules to the standard directories.
# 14. Materialize root-only administrative symlinks from the internal-scope contract.
# 15. Ensure maintenance scripts remain executable.
# 16. Grant runtime users read and traversal access to the project tree.
# 17. Optionally scaffold the first tenant when running interactively.
# 18. Install and enable the systemd service unit for Ehecoatl.
# 19. Write installation metadata to /etc/opt/ehecoatl/install-meta.env.
# 20. Verify the final setup state.
# 21. Log final installation status and next-step commands.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_PROJECT_DIR="/opt/ehecoatl"
INSTALL_DIR="$DEFAULT_PROJECT_DIR"
CLI_BASE_DIR="$INSTALL_DIR/cli"
CLI_TARGET="/usr/local/bin/ehecoatl"
SYSTEMD_TEMPLATE="$INSTALL_DIR/systemd/ehecoatl.service"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
VAR_BASE_DIR="/var/opt/ehecoatl"
SRV_BASE_DIR="/srv/opt/ehecoatl"
ETC_BASE_DIR="/etc/opt/ehecoatl"
ETC_CONFIG_DIR="$ETC_BASE_DIR/config"
ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"
ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
EHECOATL_USER="ehecoatl"
EHECOATL_GROUP="ehecoatl"
EHECOATL_GROUP_CREATED_BY_INSTALLER=0
EHECOATL_USER_CREATED_BY_INSTALLER=0
INSTALL_ID=""
SUPERVISOR_USER=""
SUPERVISOR_GROUP="g_superScope"
SUPERVISOR_USER_CREATED_BY_INSTALLER=0
SUPERVISOR_GROUP_CREATED_BY_INSTALLER=0
DIRECTOR_GROUP="g_director"
DIRECTOR_GROUP_CREATED_BY_INSTALLER=0
CURRENT_STEP=""
FORCE_INSTALL=0
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
RUNTIME_POLICY_HELPER="$INSTALL_DIR/cli/lib/runtime-policy.sh"
SETUP_TOPOLOGY_DERIVER="$INSTALL_DIR/contracts/derive-setup-topology.js"
SETUP_SYMLINKS_DERIVER="$INSTALL_DIR/contracts/derive-setup-symlinks.js"
SETUP_IDENTITIES_DERIVER="$INSTALL_DIR/contracts/derive-setup-identities.js"
INSTALL_REGISTRY_FILE=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECOATL SETUP]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail() { printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet() {
  local output
  if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi
  if ! output="$("$@" 2>&1)"; then fail "$output"; fi
}
clear_systemd_service_entry() {
  command -v systemctl >/dev/null 2>&1 || return 0
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $SUDO systemctl disable --now $SYSTEMD_UNIT_NAME"
    log "[dry-run] $SUDO rm -f $SYSTEMD_UNIT_PATH"
    log "[dry-run] $SUDO systemctl daemon-reload"
    log "[dry-run] $SUDO systemctl reset-failed $SYSTEMD_UNIT_NAME"
    return 0
  fi
  $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$SYSTEMD_UNIT_PATH"
  $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
  $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
}
cleanup_stale_cli_target() { if [ -L "$CLI_TARGET" ] && [ ! -e "$CLI_TARGET" ]; then run_quiet $SUDO rm -f "$CLI_TARGET"; fi; }
cleanup_stale_install_metadata() {
  if ! $SUDO test -f "$INSTALL_META_FILE"; then return 0; fi
  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$metadata_project_dir" ] || [ ! -d "$metadata_project_dir" ]; then run_quiet $SUDO rm -f "$INSTALL_META_FILE"; fi
}
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) FORCE_INSTALL=1 ;;
      --yes) YES_MODE=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;;
      *) fail "Unknown option: $1" ;;
    esac
    shift
  done
}
require_root() {
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    fail "setup-ehecoatl.sh must be run as root or invoked via sudo."
  fi
  fail "setup-ehecoatl.sh must be run as root. sudo is not available on this host."
}
SUDO=""
require_command() { command -v "$1" >/dev/null 2>&1; }
node_major_version() { require_command node || return 1; node -p "process.versions.node.split('.')[0]" 2>/dev/null; }
check_nodejs_24() { local current_major; current_major="$(node_major_version || true)"; [ "$current_major" = "24" ] && require_command npm; }
init_runtime_policy_helper() {
  [ -f "$RUNTIME_POLICY_HELPER" ] || fail "Installed runtime policy helper not found at $RUNTIME_POLICY_HELPER. Run setup/bootstrap-ehecoatl.sh first."
  # shellcheck source=/dev/null
  source "$RUNTIME_POLICY_HELPER"
  policy_init "$INSTALL_DIR/cli/ehecoatl.sh"
}
install_system_dependencies() {
  local need_install=0 required_commands=(python3 make iptables curl) command_name
  for command_name in "${required_commands[@]}"; do if ! require_command "$command_name"; then need_install=1; break; fi; done
  if [ "$need_install" -eq 0 ] && command -v setfacl >/dev/null 2>&1 && require_command g++; then return 0; fi
  if require_command apt-get; then
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl python3 make g++ iptables acl
    return 0
  fi
  if require_command dnf; then
    run_quiet $SUDO dnf install -y curl python3 make gcc-c++ iptables acl ca-certificates
    return 0
  fi
  fail "Could not install dependencies automatically. Please install python3, make, curl, iptables, acl, and a C++ compiler manually."
}
load_runtime_policy() {
  POLICY_PROJECT_DIR="$INSTALL_DIR"; POLICY_FILE="$INSTALL_DIR/config/runtime-policy.json"; POLICY_DERIVER="$INSTALL_DIR/contracts/derive-runtime-policy.js"
  VAR_BASE_DIR="$(policy_value 'paths.varBase')"; SRV_BASE_DIR="$(policy_value 'paths.srvBase')"; ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
  ETC_CONFIG_DIR="$ETC_BASE_DIR/config"; ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"; ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"; INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
  EHECOATL_USER="$(policy_value 'system.sharedUser')"; EHECOATL_GROUP="$(policy_value 'system.sharedGroup')"
}
derive_setup_identity_value() {
  local dotted_path="$1"
  local install_id_arg="${2:-$INSTALL_ID}"
  node "$SETUP_IDENTITIES_DERIVER" value "$dotted_path" "$install_id_arg"
}
read_existing_registry_value() {
  local dotted_path="$1"
  [ -n "${INSTALL_REGISTRY_FILE:-}" ] && $SUDO test -f "$INSTALL_REGISTRY_FILE" || return 1
  node -e '
    const fs = require(`node:fs`);
    const data = JSON.parse(fs.readFileSync(process.argv[1], `utf8`));
    const value = String(process.argv[2] ?? ``).split(`.`).reduce((current, key) => current?.[key], data);
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(String(value));
  ' "$INSTALL_REGISTRY_FILE" "$dotted_path"
}
resolve_install_identity() {
  INSTALL_ID="$(read_existing_metadata_value INSTALL_ID || true)"
  [ -n "$INSTALL_ID" ] || INSTALL_ID="$(read_existing_registry_value installId || true)"
  [ -n "$INSTALL_ID" ] || INSTALL_ID="$(node "$SETUP_IDENTITIES_DERIVER" generate-install-id)"

  SUPERVISOR_GROUP="$(derive_setup_identity_value supervisor.group "$INSTALL_ID")"
  SUPERVISOR_USER="$(derive_setup_identity_value supervisor.user "$INSTALL_ID")"
  INSTALL_REGISTRY_FILE="$(derive_setup_identity_value registryFile "$INSTALL_ID")"
}
detect_existing_install() {
  $SUDO test -f "$INSTALL_META_FILE" || return 1
  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$metadata_project_dir" ] || return 1
  [ -f "$metadata_project_dir/package.json" ] || return 1
  [ -x "$CLI_TARGET" ] || return 1
  $SUDO test -f "$SYSTEMD_UNIT_PATH" || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || return 1
}
apply_owner_group_mode() { local target_path="$1" owner_name="$2" group_name="$3" mode_value="$4"; [ -e "$target_path" ] || return 0; run_quiet $SUDO chown "$owner_name:$group_name" "$target_path"; run_quiet $SUDO chmod "$mode_value" "$target_path"; }
materialize_contract_topology() {
  [ -f "$SETUP_TOPOLOGY_DERIVER" ] || fail "Setup topology deriver not found at $SETUP_TOPOLOGY_DERIVER"

  while IFS=$'\t' read -r target_path owner_name group_name mode_value recursive_flag path_type; do
    [ -n "${target_path:-}" ] || continue
    if [ "${path_type:-directory}" = "file" ]; then
      run_quiet $SUDO mkdir -p "$(dirname "$target_path")"
    else
      run_quiet $SUDO mkdir -p "$target_path"
    fi
    apply_owner_group_mode "$target_path" "$owner_name" "$group_name" "$mode_value"
  done < <(node "$SETUP_TOPOLOGY_DERIVER" tsv)
}
materialize_contract_symlinks() {
  [ -f "$SETUP_SYMLINKS_DERIVER" ] || fail "Setup symlinks deriver not found at $SETUP_SYMLINKS_DERIVER"

  local link_path target_path workspace_dir current_target
  declare -A workspace_dirs=()

  while IFS=$'\t' read -r link_path target_path; do
    [ -n "${link_path:-}" ] || continue
    workspace_dir="$(dirname "$link_path")"

    if [ -z "${workspace_dirs[$workspace_dir]+x}" ]; then
      workspace_dirs["$workspace_dir"]=1
      run_quiet $SUDO mkdir -p "$workspace_dir"
      apply_owner_group_mode "$workspace_dir" root root 0700
    fi

    if $SUDO test -L "$link_path"; then
      current_target="$($SUDO readlink "$link_path")"
      [ "$current_target" = "$target_path" ] && continue
      run_quiet $SUDO rm -f "$link_path"
      run_quiet $SUDO ln -s "$target_path" "$link_path"
      continue
    fi

    if $SUDO test -e "$link_path"; then
      fail "Refusing to replace non-symlink path at $link_path. Remove or rename it manually."
    fi

    run_quiet $SUDO ln -s "$target_path" "$link_path"
  done < <(node "$SETUP_SYMLINKS_DERIVER" tsv)
}
prompt_and_create_first_tenant() {
  local first_tenant_domain cli_entry tenant_root tenant_json
  if [ "$NON_INTERACTIVE" -eq 1 ]; then log "Skipping first tenant scaffold in non-interactive mode."; return 0; fi
  printf 'Enter a first tenant domain to scaffold now (example.com or localhost), or leave blank to skip [skip]: '
  read -r first_tenant_domain
  [ -n "${first_tenant_domain:-}" ] || { log "Skipping first tenant scaffold."; return 0; }
  cli_entry="$CLI_BASE_DIR/ehecoatl.sh"; [ -x "$cli_entry" ] || run_quiet chmod +x "$cli_entry"
  log "Creating first tenant scaffold for domain '$first_tenant_domain' with app 'www'."
  run_quiet "$cli_entry" core deploy tenant "@$first_tenant_domain" -t empty-tenant
  tenant_json="$(node "$CLI_BASE_DIR/lib/tenant-layout-cli.js" find-tenant-json-by-domain "$VAR_BASE_DIR" "$first_tenant_domain")"
  tenant_root="$(printf '%s' "$tenant_json" | node -e 'const data = JSON.parse(require(`node:fs`).readFileSync(0, `utf8`)); process.stdout.write(String(data?.tenantRoot ?? ``));')"
  [ -n "$tenant_root" ] || fail "Could not resolve scaffolded tenant root for $first_tenant_domain"
  run_quiet bash -lc "cd '$tenant_root' && '$cli_entry' tenant deploy app 'www' -a empty-app"
  log "First tenant scaffold created at app route 'www.$first_tenant_domain'."
}
grant_project_runtime_access() {
  [ -n "$INSTALL_DIR" ] || return 0
  command -v setfacl >/dev/null 2>&1 || return 0
  local runtime_users=("$EHECOATL_USER") current_path="$INSTALL_DIR" parent_path runtime_user
  while [ "$current_path" != "/" ]; do parent_path="$(dirname "$current_path")"; [ "$parent_path" = "$current_path" ] && break; for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -m "u:${runtime_user}:x" "$parent_path"; done; current_path="$parent_path"; done
  for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -R -m "u:${runtime_user}:rX" "$INSTALL_DIR"; done
}
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
write_install_metadata() {
  local nginx_package_name nginx_service_name nginx_managed_by_installer
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
  local lets_encrypt_package_name lets_encrypt_managed_by_installer
  local existing_user_created_by_installer existing_group_created_by_installer
  local resolved_user_created_by_installer resolved_group_created_by_installer
  local existing_supervisor_user_created_by_installer existing_supervisor_group_created_by_installer
  local existing_director_group_created_by_installer
  nginx_package_name="${EHECOATL_NGINX_PACKAGE_NAME:-$(read_existing_metadata_value NGINX_PACKAGE_NAME || true)}"
  nginx_service_name="${EHECOATL_NGINX_SERVICE_NAME:-$(read_existing_metadata_value NGINX_SERVICE_NAME || true)}"
  nginx_managed_by_installer="${EHECOATL_NGINX_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value NGINX_MANAGED_BY_INSTALLER || true)}"
  redis_package_name="${EHECOATL_REDIS_PACKAGE_NAME:-$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)}"
  redis_service_name="${EHECOATL_REDIS_SERVICE_NAME:-$(read_existing_metadata_value REDIS_SERVICE_NAME || true)}"
  redis_managed_by_installer="${EHECOATL_REDIS_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)}"
  redis_supported_major="${EHECOATL_REDIS_SUPPORTED_MAJOR:-$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)}"
  lets_encrypt_package_name="${EHECOATL_LETS_ENCRYPT_PACKAGE_NAME:-$(read_existing_metadata_value LETS_ENCRYPT_PACKAGE_NAME || true)}"
  lets_encrypt_managed_by_installer="${EHECOATL_LETS_ENCRYPT_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value LETS_ENCRYPT_MANAGED_BY_INSTALLER || true)}"
  existing_user_created_by_installer="$(read_existing_metadata_value EHECOATL_USER_CREATED_BY_INSTALLER || true)"
  existing_group_created_by_installer="$(read_existing_metadata_value EHECOATL_GROUP_CREATED_BY_INSTALLER || true)"
  existing_supervisor_user_created_by_installer="$(read_existing_metadata_value SUPERVISOR_USER_CREATED_BY_INSTALLER || true)"
  existing_supervisor_group_created_by_installer="$(read_existing_metadata_value SUPERVISOR_GROUP_CREATED_BY_INSTALLER || true)"
  existing_director_group_created_by_installer="$(read_existing_metadata_value DIRECTOR_GROUP_CREATED_BY_INSTALLER || true)"
  resolved_user_created_by_installer="$EHECOATL_USER_CREATED_BY_INSTALLER"
  [ "$resolved_user_created_by_installer" = "1" ] || resolved_user_created_by_installer="${existing_user_created_by_installer:-0}"
  resolved_group_created_by_installer="$EHECOATL_GROUP_CREATED_BY_INSTALLER"
  [ "$resolved_group_created_by_installer" = "1" ] || resolved_group_created_by_installer="${existing_group_created_by_installer:-0}"
  local metadata
  metadata=$(cat <<EOF_META
PROJECT_DIR="$INSTALL_DIR"
DEFAULT_PROJECT_DIR="$DEFAULT_PROJECT_DIR"
CLI_TARGET="$CLI_TARGET"
VAR_BASE_DIR="$VAR_BASE_DIR"
SRV_BASE_DIR="$SRV_BASE_DIR"
ETC_BASE_DIR="$ETC_BASE_DIR"
EHECOATL_USER="$EHECOATL_USER"
EHECOATL_GROUP="$EHECOATL_GROUP"
INSTALL_ID="$INSTALL_ID"
SUPERVISOR_USER="$SUPERVISOR_USER"
SUPERVISOR_GROUP="$SUPERVISOR_GROUP"
DIRECTOR_GROUP="$DIRECTOR_GROUP"
EHECOATL_USER_CREATED_BY_INSTALLER="$resolved_user_created_by_installer"
EHECOATL_GROUP_CREATED_BY_INSTALLER="$resolved_group_created_by_installer"
SUPERVISOR_USER_CREATED_BY_INSTALLER="${SUPERVISOR_USER_CREATED_BY_INSTALLER:-${existing_supervisor_user_created_by_installer:-0}}"
SUPERVISOR_GROUP_CREATED_BY_INSTALLER="${SUPERVISOR_GROUP_CREATED_BY_INSTALLER:-${existing_supervisor_group_created_by_installer:-0}}"
DIRECTOR_GROUP_CREATED_BY_INSTALLER="${DIRECTOR_GROUP_CREATED_BY_INSTALLER:-${existing_director_group_created_by_installer:-0}}"
INSTALLER_PACKAGE_MANAGER="${EHECOATL_INSTALLER_PACKAGE_MANAGER:-}"
INSTALLER_MANAGED_PACKAGES="${EHECOATL_INSTALLER_MANAGED_PACKAGES:-}"
NGINX_PACKAGE_NAME="${nginx_package_name:-}"
NGINX_SERVICE_NAME="${nginx_service_name:-}"
NGINX_MANAGED_BY_INSTALLER="${nginx_managed_by_installer:-0}"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
LETS_ENCRYPT_PACKAGE_NAME="${lets_encrypt_package_name:-}"
LETS_ENCRYPT_MANAGED_BY_INSTALLER="${lets_encrypt_managed_by_installer:-0}"
EOF_META
)
  run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"
  if ! printf '%s\n' "$metadata" | { [ "$DRY_RUN" -eq 1 ] && cat >/dev/null || $SUDO tee "$INSTALL_META_FILE" >/dev/null; }; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
  [ "$DRY_RUN" -eq 1 ] || apply_owner_group_mode "$INSTALL_META_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 640
}
write_install_registry() {
  local registry_dir registry_json
  registry_dir="$(dirname "$INSTALL_REGISTRY_FILE")"
  registry_json=$(cat <<EOF_REGISTRY
{
  "installId": "$INSTALL_ID",
  "internal": {
    "user": "$EHECOATL_USER",
    "group": "$EHECOATL_GROUP"
  },
  "supervisor": {
    "user": "$SUPERVISOR_USER",
    "group": "$SUPERVISOR_GROUP"
  },
  "director": {
    "group": "$DIRECTOR_GROUP"
  },
  "writtenAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF_REGISTRY
)
  run_quiet $SUDO mkdir -p "$registry_dir"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write install registry to $INSTALL_REGISTRY_FILE"
    return 0
  fi
  printf '%s\n' "$registry_json" | $SUDO tee "$INSTALL_REGISTRY_FILE" >/dev/null
  apply_owner_group_mode "$INSTALL_REGISTRY_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 640
}
verify_setup_state() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -x "$CLI_TARGET" ] || fail "CLI target not available at $CLI_TARGET"
  [ -f "$INSTALL_DIR/package.json" ] || fail "Installed runtime package.json not found at $INSTALL_DIR/package.json"
  [ -x "$INSTALL_DIR/cli/ehecoatl.sh" ] || fail "CLI dispatcher is not executable at $INSTALL_DIR/cli/ehecoatl.sh"
  [ -f "$INSTALL_DIR/systemd/ehecoatl.service" ] || fail "Systemd template not found at $INSTALL_DIR/systemd/ehecoatl.service"
  $SUDO test -f "$INSTALL_META_FILE" || fail "Install metadata not found at $INSTALL_META_FILE"
  $SUDO test -f "$INSTALL_REGISTRY_FILE" || fail "Install registry not found at $INSTALL_REGISTRY_FILE"
  id "$SUPERVISOR_USER" >/dev/null 2>&1 || fail "Auto-generated supervision scope user not found: $SUPERVISOR_USER"
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required but unavailable."
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not enabled."
  $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not active."
}
install_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for runtime service setup."
  [ -f "$SYSTEMD_TEMPLATE" ] || fail "Systemd template not found at $SYSTEMD_TEMPLATE"
  local escaped_project_dir; escaped_project_dir="$(printf '%s\n' "$INSTALL_DIR" | sed 's/[\/&]/\\&/g')"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write systemd unit to $SYSTEMD_UNIT_PATH from $SYSTEMD_TEMPLATE"
    log "[dry-run] $SUDO systemctl daemon-reload"
    log "[dry-run] $SUDO systemctl enable --now $SYSTEMD_UNIT_NAME"
    return 0
  fi
  if ! sed "s/__PROJECT_DIR__/$escaped_project_dir/g" "$SYSTEMD_TEMPLATE" | $SUDO tee "$SYSTEMD_UNIT_PATH" >/dev/null; then fail "Could not write systemd unit at $SYSTEMD_UNIT_PATH"; fi
  run_quiet $SUDO chmod 644 "$SYSTEMD_UNIT_PATH"
  run_quiet $SUDO systemctl daemon-reload
  run_quiet $SUDO systemctl enable --now "$SYSTEMD_UNIT_NAME"
}
is_project_in_default_dir() {
  [ "$INSTALL_DIR" = "$DEFAULT_PROJECT_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]
}
is_redis_enabled_from_metadata() {
  local redis_managed_by_installer
  redis_managed_by_installer="$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)"
  [ "$redis_managed_by_installer" = "1" ]
}
write_split_json_config() {
  local source_config="$INSTALL_DIR/config/default.config.js"
  local target_dir="$ETC_CONFIG_DIR"
  local redis_enabled="0"

  [ -f "$source_config" ] || fail "Default config file not found at $source_config"

  if is_redis_enabled_from_metadata; then
    redis_enabled="1"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FORCE_INSTALL" -eq 1 ]; then
      log "[dry-run] Regenerate runtime/*.json, plugins/*.json, and adapters/*.json in $target_dir from $source_config"
    else
      log "[dry-run] Create missing runtime/*.json, plugins/*.json, and adapters/*.json in $target_dir from $source_config"
    fi
    if [ "$redis_enabled" = "1" ]; then
      log "[dry-run] Force adapters/sharedCacheService.json adapter=redis because install metadata indicates Redis is enabled"
    fi
    return 0
  fi

  run_quiet $SUDO mkdir -p "$target_dir"

  local node_script
  node_script='
const fs = require("fs");
const path = require("path");

const sourceConfig = process.argv[1];
const targetDir = process.argv[2];
const forceMode = process.argv[3] === "1";
const redisEnabled = process.argv[4] === "1";

const loaded = require(sourceConfig);
const config = loaded && loaded.default ? loaded.default : loaded;

if (!config || typeof config !== "object" || Array.isArray(config)) {
  console.error("default.config.js must export a plain object at the root.");
  process.exit(1);
}

if (redisEnabled) {
  if (!config.adapters || typeof config.adapters !== "object" || Array.isArray(config.adapters)) {
    config.adapters = {};
  }
  if (!config.adapters.sharedCacheService || typeof config.adapters.sharedCacheService !== "object" || Array.isArray(config.adapters.sharedCacheService)) {
    config.adapters.sharedCacheService = {};
  }
  config.adapters.sharedCacheService.adapter = "redis";
}

fs.mkdirSync(targetDir, { recursive: true });

const managedKeys = [`runtime`, `plugins`, `adapters`];

for (const key of managedKeys) {
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.error(`Root property "${key}" must be a plain object.`);
    process.exit(1);
  }

  const groupDir = path.join(targetDir, key);
  fs.mkdirSync(groupDir, { recursive: true });

  const managedEntries = new Set(Object.keys(value));
  for (const entryName of fs.readdirSync(groupDir)) {
    if (!entryName.toLowerCase().endsWith(`.json`)) continue;
    const baseName = path.basename(entryName, path.extname(entryName));
    if (managedEntries.has(baseName)) continue;
    fs.unlinkSync(path.join(groupDir, entryName));
  }

  const legacyGroupFile = path.join(targetDir, `${key}.json`);
  if (fs.existsSync(legacyGroupFile)) {
    fs.unlinkSync(legacyGroupFile);
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    const outPath = path.join(groupDir, `${entryKey}.json`);
    if (!forceMode && fs.existsSync(outPath)) continue;

    const json = JSON.stringify(entryValue, null, 2);
    if (typeof json !== "string") {
      console.error(`Config property "${key}.${entryKey}" is not JSON-serializable.`);
      process.exit(1);
    }

    fs.writeFileSync(outPath, json + "\n", "utf8");
  }
}
'

  local output
  if ! output="$(node -e "$node_script" "$source_config" "$target_dir" "$FORCE_INSTALL" "$redis_enabled" 2>&1)"; then
    fail "$output"
  fi

  local config_path
  while IFS= read -r config_path; do
    [ -n "$config_path" ] || continue
    if [ -d "$config_path" ]; then
      apply_owner_group_mode "$config_path" "$EHECOATL_USER" "$EHECOATL_GROUP" 755
      continue
    fi
    apply_owner_group_mode "$config_path" "$EHECOATL_USER" "$EHECOATL_GROUP" 644
  done < <(find "$target_dir" -mindepth 1 \( -type d -o -type f -name '*.json' \) | sort)
}
print_dry_run_summary() {
  log "Dry run summary:"
  log "What may be installed:"
  log "  - python3, make, g++, iptables, acl, curl, ca-certificates when missing"
  log "  - Node.js service dependencies via npm install"
  log "  - system users/groups: $EHECOATL_GROUP, $EHECOATL_USER, $SUPERVISOR_GROUP, $SUPERVISOR_USER, $DIRECTOR_GROUP"
  log "What will be changed:"
  log "  - Publish CLI symlink at $CLI_TARGET"
  log "  - Create runtime directories under $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR"
  log "  - Create/update root-only helper symlinks under /root/ehecoatl"
  log "  - Create missing runtime/*.json, plugins/*.json, and adapters/*.json under $ETC_CONFIG_DIR from $INSTALL_DIR/config/default.config.js"
  log "  - With --force, regenerate runtime/*.json, plugins/*.json, and adapters/*.json under $ETC_CONFIG_DIR"
  log "  - Write/refresh systemd unit at $SYSTEMD_UNIT_PATH"
  log "  - Write install metadata to $INSTALL_META_FILE"
  log "  - Write install registry to $INSTALL_REGISTRY_FILE"
}

# Step 1: Prepare setup execution.
step 1 "Preparing installation"
log "Installing Ehecoatl..."
parse_args "$@"
require_root

# Step 2: Validate the installation directory.
step 2 "Validating installation directory"
is_project_in_default_dir || fail "Installed runtime not found at $DEFAULT_PROJECT_DIR. Run setup/bootstrap-ehecoatl.sh first."
init_runtime_policy_helper

# Step 3: Load runtime policy values.
step 3 "Loading runtime policy"
load_runtime_policy
resolve_install_identity
if [ "$DRY_RUN" -eq 1 ]; then print_dry_run_summary; exit 0; fi
if detect_existing_install; then
  if [ "$FORCE_INSTALL" -eq 0 ]; then log "Detected an existing installation. Setup will stop without changes."; log "Run setup/setup-ehecoatl.sh --force to reapply setup and runtime service provisioning."; exit 0; fi
  log "Detected an existing installation; continuing because --force was provided."
fi

# Step 4: Clean stale runtime leftovers.
step 4 "Cleaning stale runtime leftovers"
clear_systemd_service_entry
cleanup_stale_cli_target
cleanup_stale_install_metadata

# Step 5: Install required system dependencies.
step 5 "Installing system dependencies"
install_system_dependencies

# Step 6: Verify the supported Node.js runtime.
step 6 "Checking Node.js version"
check_nodejs_24 || fail "Node.js 24 is required."

# Step 7: Install Node.js application dependencies.
step 7 "Installing Node.js dependencies"
cd "$INSTALL_DIR"
run_quiet npm install --silent --no-fund --no-audit

# Step 8: Create the shared runtime group.
step 8 "Creating runtime group"
if ! getent group "$EHECOATL_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$EHECOATL_GROUP"
  EHECOATL_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$EHECOATL_GROUP' already exists."
fi

# Step 9: Create the shared runtime user.
step 9 "Creating runtime user"
if ! id "$EHECOATL_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$EHECOATL_USER"
  EHECOATL_USER_CREATED_BY_INSTALLER=1
else
  log "System user '$EHECOATL_USER' already exists."
  run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$EHECOATL_USER"
  run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$EHECOATL_USER"
fi

# Step 10: Create the supervision scope group and auto-generated scope user.
step 10 "Creating supervision scope identity"
if ! getent group "$SUPERVISOR_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$SUPERVISOR_GROUP"
  SUPERVISOR_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$SUPERVISOR_GROUP' already exists."
fi
if ! id "$SUPERVISOR_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$SUPERVISOR_GROUP" --no-create-home --shell /usr/sbin/nologin "$SUPERVISOR_USER"
  SUPERVISOR_USER_CREATED_BY_INSTALLER=1
else
  log "System user '$SUPERVISOR_USER' already exists."
  run_quiet $SUDO usermod -g "$SUPERVISOR_GROUP" "$SUPERVISOR_USER"
fi

if ! getent group "$DIRECTOR_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$DIRECTOR_GROUP"
  DIRECTOR_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$DIRECTOR_GROUP' already exists."
fi

# Step 11: Publish the Ehecoatl CLI command.
step 11 "Publishing CLI command"
run_quiet $SUDO chmod +x "$CLI_BASE_DIR/ehecoatl.sh"
while IFS= read -r cli_script; do
  [ -n "$cli_script" ] || continue
  run_quiet $SUDO chmod +x "$cli_script"
done < <(find "$CLI_BASE_DIR/commands" -type f -name '*.sh' | sort)
run_quiet $SUDO ln -sfn "$CLI_BASE_DIR/ehecoatl.sh" "$CLI_TARGET"

# Step 12: Create the standard runtime directories.
step 12 "Creating contract-defined system topology"
materialize_contract_topology
log "Writing split JSON configuration"
write_split_json_config

# Step 13: Apply ownership and permissions.
step 13 "Setting permissions"
materialize_contract_topology

# Step 14: Materialize root-only administrative symlinks.
step 14 "Materializing root helper symlinks"
materialize_contract_symlinks

# Step 15: Grant runtime users access to the installed runtime tree.
step 15 "Granting installed runtime access"
grant_project_runtime_access

# Step 16: Optionally scaffold the first tenant.
step 16 "Optional first tenant scaffold"
prompt_and_create_first_tenant

# Step 17: Install the runtime service.
step 17 "Installing runtime service"
install_systemd_service

# Step 18: Write installation metadata and registry.
step 18 "Writing installation metadata"
write_install_metadata
write_install_registry

# Step 19: Verify the final setup state.
step 19 "Verifying setup state"
verify_setup_state

# Step 20: Finish the setup flow.
step 20 "Finishing"
log "Ehecoatl installed successfully."
log "Use 'ehecoatl core start' to launch manually when needed."
log "Use setup/bootstraps/bootstrap-nginx.sh only when you want Ehecoatl to manage a local Nginx installation."
log "Use setup/bootstraps/bootstrap-lets-encrypt.sh only when you want Ehecoatl to manage a local Let's Encrypt client installation."
log "Use setup/bootstraps/bootstrap-redis.sh only when you want Ehecoatl to manage a local Redis ${EHECOATL_REDIS_SUPPORTED_MAJOR:-7}.x installation."
