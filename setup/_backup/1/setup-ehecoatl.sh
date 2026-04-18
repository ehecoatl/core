#!/bin/bash
set -euo pipefail

# Setup flow:
# 1. Resolve project-relative paths and load the runtime policy helper.
# 2. Initialize default install paths, runtime users, argument parsing, and shell helpers.
# 3. Determine whether sudo is required for privileged operations.
# 4. Define command detection and Node.js version validation helpers.
# 5. Define installation of required non-Node system dependencies.
# 6. Offer to move the project into /opt/ehecoatl when running elsewhere.
# 7. Load app/config/runtime-policy.json and derive runtime paths/users from it.
# 8. Install missing system dependencies such as python3, make, iptables, acl, and curl.
# 9. Verify that Node.js 24 with npm is already available on the machine.
# 10. Run npm install for project dependencies.
# 11. Create the shared runtime user if missing.
# 12. Create the default child-process users declared by policy if missing.
# 13. Publish the Ehecoatl CLI via a symlink in /usr/local/bin.
# 14. Create the standard /var, /srv, and /etc directory layout.
# 15. Apply ownership and permissions to the standard directories.
# 16. Install and enable the systemd service unit for Ehecoatl.
# 17. Write installation metadata to /etc/opt/ehecoatl/install-meta.env.
# 18. Log final installation status and next-step commands.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_PROJECT_DIR="/opt/ehecoatl"
source "$SCRIPT_DIR/lib/runtime-policy.sh"
CLI_BASE_DIR="$PROJECT_DIR/cli"
CLI_TARGET="/usr/local/bin/ehecoatl"
SYSTEMD_TEMPLATE="$SCRIPT_DIR/systemd/ehecoatl.service"
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
DEFAULT_CHILD_USERS=("e_manager" "e_engine")
CURRENT_STEP=""
FORCE_INSTALL=0
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0

log() { printf '[SETUP] %s\n' "$1"; }
fail() { printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet() {
  local output
  if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi
  if ! output="$("$@" 2>&1)"; then fail "$output"; fi
}
clear_pm2_app_entry() { command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecoatl"; return 0; }; $SUDO pm2 delete Ehecoatl >/dev/null 2>&1 || true; }
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
step() { CURRENT_STEP="$1"; log "$CURRENT_STEP"; }
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
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to install Ehecoatl."; SUDO="sudo"; fi
require_command() { command -v "$1" >/dev/null 2>&1; }
node_major_version() { require_command node || return 1; node -p "process.versions.node.split('.')[0]" 2>/dev/null; }
check_nodejs_24() { local current_major; current_major="$(node_major_version || true)"; [ "$current_major" = "24" ] && require_command npm; }
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
  POLICY_PROJECT_DIR="$PROJECT_DIR"; POLICY_FILE="$PROJECT_DIR/app/config/runtime-policy.json"
  VAR_BASE_DIR="$(policy_value 'paths.varBase')"; SRV_BASE_DIR="$(policy_value 'paths.srvBase')"; ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
  ETC_CONFIG_DIR="$ETC_BASE_DIR/config"; ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"; ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"; INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
  EHECOATL_USER="$(policy_value 'system.sharedUser')"; EHECOATL_GROUP="$(policy_value 'system.sharedGroup')"
  DEFAULT_CHILD_USERS=(); local manager_user engine_user child_user
  manager_user="$(policy_value 'processUsers.manager.user')"; engine_user="$(policy_value 'processUsers.engine.user')"
  for child_user in "$manager_user" "$engine_user"; do case " ${DEFAULT_CHILD_USERS[*]} " in *" $child_user "*) ;; *) DEFAULT_CHILD_USERS+=("$child_user") ;; esac; done
}
detect_existing_install() {
  $SUDO test -f "$INSTALL_META_FILE" || return 1
  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$metadata_project_dir" ] || return 1
  [ -d "$metadata_project_dir/app" ] || return 1
  [ -x "$CLI_TARGET" ] || return 1
  $SUDO test -f "$SYSTEMD_UNIT_PATH" || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || return 1
}
apply_owner_group_mode() { local target_path="$1" owner_name="$2" group_name="$3" mode_value="$4"; [ -e "$target_path" ] || return 0; run_quiet $SUDO chown "$owner_name:$group_name" "$target_path"; run_quiet $SUDO chmod "$mode_value" "$target_path"; }
apply_standard_directory_permissions() { local managed_dirs=("$VAR_BASE_DIR" "$VAR_BASE_DIR/adapters" "$VAR_BASE_DIR/plugins" "$VAR_BASE_DIR/backups" "$VAR_BASE_DIR/cache" "$VAR_BASE_DIR/lib" "$VAR_BASE_DIR/logs" "$VAR_BASE_DIR/spool" "$VAR_BASE_DIR/tenants" "$SRV_BASE_DIR" "$ETC_BASE_DIR" "$ETC_CONFIG_DIR" "$ETC_ADAPTERS_DIR" "$ETC_PLUGINS_DIR") managed_dir; for managed_dir in "${managed_dirs[@]}"; do apply_owner_group_mode "$managed_dir" "$EHECOATL_USER" "$EHECOATL_GROUP" 2775; done; }
ensure_maintenance_scripts_executable() { local maintenance_scripts=("$SCRIPT_DIR/bootstrap-system.sh" "$SCRIPT_DIR/bootstrap-redis.sh" "$SCRIPT_DIR/setup-ehecoatl.sh" "$SCRIPT_DIR/uninstall-ehecoatl.sh" "$SCRIPT_DIR/uninstall-redis.sh" "$SCRIPT_DIR/purge-ehecoatl-data.sh") script_path; for script_path in "${maintenance_scripts[@]}"; do [ -f "$script_path" ] || continue; run_quiet $SUDO chmod 775 "$script_path"; done; }
prompt_and_create_first_tenant() {
  local first_tenant_domain tenant_create_cmd
  if [ "$NON_INTERACTIVE" -eq 1 ]; then log "Skipping first tenant scaffold in non-interactive mode."; return 0; fi
  printf 'Enter a first tenant domain to scaffold now (example.com or localhost), or leave blank to skip [skip]: '
  read -r first_tenant_domain
  [ -n "${first_tenant_domain:-}" ] || { log "Skipping first tenant scaffold."; return 0; }
  tenant_create_cmd="$CLI_BASE_DIR/commands/tenant_create"; [ -x "$tenant_create_cmd" ] || run_quiet chmod +x "$tenant_create_cmd"
  log "Creating first tenant scaffold for domain '$first_tenant_domain' with host 'www'."
  run_quiet "$tenant_create_cmd" "$first_tenant_domain" -host www
  log "First tenant scaffold created at host 'www.$first_tenant_domain'."
}
grant_project_runtime_access() {
  [ -n "$PROJECT_DIR" ] || return 0
  command -v setfacl >/dev/null 2>&1 || return 0
  local runtime_users=("$EHECOATL_USER" "${DEFAULT_CHILD_USERS[@]}") current_path="$PROJECT_DIR" parent_path runtime_user
  while [ "$current_path" != "/" ]; do parent_path="$(dirname "$current_path")"; [ "$parent_path" = "$current_path" ] && break; for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -m "u:${runtime_user}:x" "$parent_path"; done; current_path="$parent_path"; done
  for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -R -m "u:${runtime_user}:rX" "$PROJECT_DIR"; done
}
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
write_install_metadata() {
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
  redis_package_name="${EHECOATL_REDIS_PACKAGE_NAME:-$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)}"
  redis_service_name="${EHECOATL_REDIS_SERVICE_NAME:-$(read_existing_metadata_value REDIS_SERVICE_NAME || true)}"
  redis_managed_by_installer="${EHECOATL_REDIS_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)}"
  redis_supported_major="${EHECOATL_REDIS_SUPPORTED_MAJOR:-$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)}"
  local metadata
  metadata=$(cat <<EOF_META
PROJECT_DIR="$PROJECT_DIR"
DEFAULT_PROJECT_DIR="$DEFAULT_PROJECT_DIR"
CLI_TARGET="$CLI_TARGET"
VAR_BASE_DIR="$VAR_BASE_DIR"
SRV_BASE_DIR="$SRV_BASE_DIR"
ETC_BASE_DIR="$ETC_BASE_DIR"
EHECOATL_USER="$EHECOATL_USER"
EHECOATL_GROUP="$EHECOATL_GROUP"
INSTALLER_PACKAGE_MANAGER="${EHECOATL_INSTALLER_PACKAGE_MANAGER:-}"
INSTALLER_MANAGED_PACKAGES="${EHECOATL_INSTALLER_MANAGED_PACKAGES:-}"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
EOF_META
)
  run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"
  if ! printf '%s\n' "$metadata" | { [ "$DRY_RUN" -eq 1 ] && cat >/dev/null || $SUDO tee "$INSTALL_META_FILE" >/dev/null; }; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
  [ "$DRY_RUN" -eq 1 ] || apply_owner_group_mode "$INSTALL_META_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 640
}
verify_setup_state() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -x "$CLI_TARGET" ] || fail "CLI target not available at $CLI_TARGET"
  [ -d "$PROJECT_DIR/app" ] || fail "Project app directory not found at $PROJECT_DIR/app"
  [ -x "$PROJECT_DIR/setup/setup-ehecoatl.sh" ] || fail "Setup script is not executable at $PROJECT_DIR/setup/setup-ehecoatl.sh"
  [ -x "$PROJECT_DIR/setup/uninstall-ehecoatl.sh" ] || fail "Uninstall script is not executable at $PROJECT_DIR/setup/uninstall-ehecoatl.sh"
  [ -x "$PROJECT_DIR/setup/uninstall-redis.sh" ] || fail "Redis uninstall script is not executable at $PROJECT_DIR/setup/uninstall-redis.sh"
  [ -x "$PROJECT_DIR/setup/purge-ehecoatl-data.sh" ] || fail "Purge script is not executable at $PROJECT_DIR/setup/purge-ehecoatl-data.sh"
  $SUDO test -f "$INSTALL_META_FILE" || fail "Install metadata not found at $INSTALL_META_FILE"
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required but unavailable."
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not enabled."
  $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not active."
}
install_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for runtime service setup."
  [ -f "$SYSTEMD_TEMPLATE" ] || fail "Systemd template not found at $SYSTEMD_TEMPLATE"
  local escaped_project_dir; escaped_project_dir="$(printf '%s\n' "$PROJECT_DIR" | sed 's/[\/&]/\\&/g')"
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
  [ "$PROJECT_DIR" = "$DEFAULT_PROJECT_DIR" ]
}
print_dry_run_summary() {
  log "Dry run summary:"
  log "What may be installed:"
  log "  - python3, make, g++, iptables, acl, curl, ca-certificates when missing"
  log "  - Node.js app dependencies via npm install"
  log "  - system users/groups: $EHECOATL_GROUP, $EHECOATL_USER, ${DEFAULT_CHILD_USERS[*]}"
  log "What will be changed:"
  log "  - Publish CLI symlink at $CLI_TARGET"
  log "  - Create runtime directories under $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR"
  log "  - Write/refresh systemd unit at $SYSTEMD_UNIT_PATH"
  log "  - Write install metadata to $INSTALL_META_FILE"
}

step "Preparing installation"
log "Installing Ehecoatl..."
parse_args "$@"
step "Validating installation directory"
is_project_in_default_dir || fail "Ehecoatl setup must be run from $DEFAULT_PROJECT_DIR. Run setup/bootstrap-system.sh first."
step "Loading runtime policy"
load_runtime_policy
if [ "$DRY_RUN" -eq 1 ]; then print_dry_run_summary; exit 0; fi
if detect_existing_install; then
  if [ "$FORCE_INSTALL" -eq 0 ]; then log "Detected an existing installation. Setup will stop without changes."; log "Run setup/setup-ehecoatl.sh --force to reapply setup and runtime service provisioning."; exit 0; fi
  log "Detected an existing installation; continuing because --force was provided."
fi
step "Cleaning stale runtime leftovers"; clear_pm2_app_entry; clear_systemd_service_entry; cleanup_stale_cli_target; cleanup_stale_install_metadata
step "Installing system dependencies"; install_system_dependencies
step "Checking Node.js version"; check_nodejs_24 || fail "Node.js 24 is required."
step "Installing Node.js dependencies"; cd "$PROJECT_DIR/app"; run_quiet npm install --silent --no-fund --no-audit
step "Creating runtime group"; if ! getent group "$EHECOATL_GROUP" >/dev/null 2>&1; then run_quiet $SUDO groupadd --system "$EHECOATL_GROUP"; else log "System group '$EHECOATL_GROUP' already exists."; fi
step "Creating runtime user"; if ! id "$EHECOATL_USER" >/dev/null 2>&1; then run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$EHECOATL_USER"; else log "System user '$EHECOATL_USER' already exists."; run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$EHECOATL_USER"; run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$EHECOATL_USER"; fi
for child_user in "${DEFAULT_CHILD_USERS[@]}"; do if ! id "$child_user" >/dev/null 2>&1; then run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$child_user"; else log "System user '$child_user' already exists."; run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$child_user"; run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$child_user"; fi; done
step "Publishing CLI command"; run_quiet $SUDO chmod +x "$CLI_BASE_DIR/ehecoatl"; run_quiet $SUDO ln -sfn "$CLI_BASE_DIR/ehecoatl" "$CLI_TARGET"
step "Creating standard directories"; run_quiet $SUDO mkdir -p "$VAR_BASE_DIR/adapters" "$VAR_BASE_DIR/plugins" "$VAR_BASE_DIR/backups" "$VAR_BASE_DIR/cache" "$VAR_BASE_DIR/lib" "$VAR_BASE_DIR/logs" "$VAR_BASE_DIR/spool" "$VAR_BASE_DIR/tenants" "$SRV_BASE_DIR" "$ETC_CONFIG_DIR" "$ETC_ADAPTERS_DIR" "$ETC_PLUGINS_DIR"
step "Setting permissions"; apply_standard_directory_permissions
step "Ensuring maintenance script permissions"; ensure_maintenance_scripts_executable
step "Granting project access"; grant_project_runtime_access
step "Optional first tenant scaffold"; prompt_and_create_first_tenant
step "Installing runtime service"; install_systemd_service
step "Writing installation metadata"; write_install_metadata
step "Verifying setup state"; verify_setup_state
step "Finishing"; log "Ehecoatl installed successfully."; log "Use 'ehecoatl start' to launch manually when needed."; log "Use setup/bootstrap-redis.sh only when you want Ehecoatl to manage a local Redis ${EHECOATL_REDIS_SUPPORTED_MAJOR:-7}.x installation."
