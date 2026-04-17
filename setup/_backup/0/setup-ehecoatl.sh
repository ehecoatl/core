#!/bin/bash
set -euo pipefail

# Setup flow:
# 1. Resolve project-relative paths and load the runtime policy helper.
# 2. Initialize default install paths, runtime users, and shell helpers.
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
DEFAULT_CHILD_USERS=(
  "e_manager"
  "e_engine"
)

CURRENT_STEP=""
FORCE_INSTALL=0

# Stage 2: helper functions for setup logging, failure handling, and step reporting.
log() {
  printf '[SETUP] %s\n' "$1"
}

fail() {
  printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2
  if [ -n "${1:-}" ]; then
    printf '[ERROR] %s\n' "$1" >&2
  fi
  exit 1
}

run_quiet() {
  local output
  if ! output="$("$@" 2>&1)"; then
    fail "$output"
  fi
}

clear_pm2_app_entry() {
  command -v pm2 >/dev/null 2>&1 || return 0
  $SUDO pm2 delete Ehecoatl >/dev/null 2>&1 || true
}

clear_systemd_service_entry() {
  command -v systemctl >/dev/null 2>&1 || return 0
  $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$SYSTEMD_UNIT_PATH"
  $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
  $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
}

cleanup_stale_cli_target() {
  if [ -L "$CLI_TARGET" ] && [ ! -e "$CLI_TARGET" ]; then
    run_quiet $SUDO rm -f "$CLI_TARGET"
  fi
}

cleanup_stale_install_metadata() {
  if ! $SUDO test -f "$INSTALL_META_FILE"; then
    return 0
  fi

  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$metadata_project_dir" ]; then
    run_quiet $SUDO rm -f "$INSTALL_META_FILE"
    return 0
  fi

  if [ ! -d "$metadata_project_dir" ]; then
    run_quiet $SUDO rm -f "$INSTALL_META_FILE"
  fi
}

step() {
  CURRENT_STEP="$1"
  log "$CURRENT_STEP"
}

trap 'fail "Command failed on line $LINENO."' ERR

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force)
        FORCE_INSTALL=1
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

# Stage 3: resolve whether privileged operations will use sudo.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to install Ehecoatl."
  SUDO="sudo"
fi

require_command() {
  command -v "$1" >/dev/null 2>&1
}

# Stage 4: validate that the required Node.js runtime is already available.
node_major_version() {
  if ! require_command node; then
    return 1
  fi
  node -p "process.versions.node.split('.')[0]" 2>/dev/null
}

check_nodejs_24() {
  local current_major
  current_major="$(node_major_version || true)"
  if [ "$current_major" = "24" ] && require_command npm; then
    return 0
  fi
  log "Node.js 24 with npm is required but not currently available."
  log "Current detected node major: ${current_major:-none}"
  log "Please install Node.js 24 before running Ehecoatl."
  return 1
}

# Stage 5: install non-Node system dependencies required by Ehecoatl and npm native builds.
install_system_dependencies() {
  local need_install=0
  for cmd in python3 make iptables; do
    if ! require_command "$cmd"; then
      need_install=1
      break
    fi
  done
 
  if [ "$need_install" -eq 0 ]; then
    return 0
  fi

  if require_command apt-get; then
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      ca-certificates curl python3 make g++ iptables acl
    return 0
  fi

  if require_command dnf; then
    run_quiet $SUDO dnf install -y curl python3 make gcc-c++ iptables acl
    return 0
  fi

  fail "Could not install dependencies automatically. Please install python3, make and a C++ compiler manually."
}

# Stage 6: offer relocation to the default project directory before provisioning continues.
maybe_move_to_default_dir() {
  if [ "$PROJECT_DIR" = "$DEFAULT_PROJECT_DIR" ]; then
    return 0
  fi

  log "Project directory: $PROJECT_DIR"
  log "Default project directory: $DEFAULT_PROJECT_DIR"
  printf 'Move this project to the default directory before installation? [Y/n] '
  read -r move_to_default

  case "${move_to_default:-Y}" in
    Y|y|Yes|yes|"")
      if [ -e "$DEFAULT_PROJECT_DIR" ]; then
        fail "Cannot move project: target already exists at $DEFAULT_PROJECT_DIR"
      fi

      run_quiet $SUDO mkdir -p "$(dirname "$DEFAULT_PROJECT_DIR")"
      run_quiet $SUDO mv "$PROJECT_DIR" "$DEFAULT_PROJECT_DIR"

      PROJECT_DIR="$DEFAULT_PROJECT_DIR"
      CLI_BASE_DIR="$PROJECT_DIR/cli"
      log "Project moved to $PROJECT_DIR"
      ;;
    N|n|No|no)
      log "Continuing installation from current directory."
      ;;
    *)
      fail "Invalid option. Installation cancelled."
      ;;
  esac
}

# Stage 7: load runtime-policy.json and derive install paths and runtime users from it.
load_runtime_policy() {
  POLICY_PROJECT_DIR="$PROJECT_DIR"
  POLICY_FILE="$PROJECT_DIR/app/config/runtime-policy.json"

  VAR_BASE_DIR="$(policy_value 'paths.varBase')"
  SRV_BASE_DIR="$(policy_value 'paths.srvBase')"
  ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
  ETC_CONFIG_DIR="$ETC_BASE_DIR/config"
  ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"
  ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"
  INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"

  EHECOATL_USER="$(policy_value 'system.sharedUser')"
  EHECOATL_GROUP="$(policy_value 'system.sharedGroup')"

  DEFAULT_CHILD_USERS=()
  local manager_user engine_user
  manager_user="$(policy_value 'processUsers.manager.user')"
  engine_user="$(policy_value 'processUsers.engine.user')"
  for child_user in "$manager_user" "$engine_user"; do
    case " ${DEFAULT_CHILD_USERS[*]} " in
      *" $child_user "*) ;;
      *) DEFAULT_CHILD_USERS+=("$child_user") ;;
    esac
  done
}

detect_existing_install() {
  if ! $SUDO test -f "$INSTALL_META_FILE"; then
    return 1
  fi

  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$metadata_project_dir" ] || return 1
  [ -d "$metadata_project_dir/app" ] || return 1
  [ -x "$CLI_TARGET" ] || return 1
  $SUDO test -f "$SYSTEMD_UNIT_PATH" || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  if ! $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

apply_owner_group_mode() {
  local target_path="$1"
  local owner_name="$2"
  local group_name="$3"
  local mode_value="$4"

  [ -e "$target_path" ] || return 0
  run_quiet $SUDO chown "$owner_name:$group_name" "$target_path"
  run_quiet $SUDO chmod "$mode_value" "$target_path"
}

apply_standard_directory_permissions() {
  local managed_dirs=(
    "$VAR_BASE_DIR"
    "$VAR_BASE_DIR/adapters"
    "$VAR_BASE_DIR/plugins"
    "$VAR_BASE_DIR/backups"
    "$VAR_BASE_DIR/cache"
    "$VAR_BASE_DIR/lib"
    "$VAR_BASE_DIR/logs"
    "$VAR_BASE_DIR/spool"
    "$VAR_BASE_DIR/tenants"
    "$SRV_BASE_DIR"
    "$ETC_BASE_DIR"
    "$ETC_CONFIG_DIR"
    "$ETC_ADAPTERS_DIR"
    "$ETC_PLUGINS_DIR"
  )
  local managed_dir

  for managed_dir in "${managed_dirs[@]}"; do
    apply_owner_group_mode "$managed_dir" "$EHECOATL_USER" "$EHECOATL_GROUP" 2775
  done
}

ensure_maintenance_scripts_executable() {
  local maintenance_scripts=(
    "$SCRIPT_DIR/setup-ehecoatl.sh"
    "$SCRIPT_DIR/uninstall-ehecoatl.sh"
    "$SCRIPT_DIR/purge-ehecoatl-data.sh"
  )
  local script_path

  for script_path in "${maintenance_scripts[@]}"; do
    [ -f "$script_path" ] || continue
    run_quiet $SUDO chmod 775 "$script_path"
  done
}

prompt_and_create_first_tenant() {
  local first_tenant_domain
  local tenant_create_cmd

  printf 'Enter a first tenant domain to scaffold now (example.com or localhost), or leave blank to skip [skip]: '
  read -r first_tenant_domain

  case "${first_tenant_domain:-}" in
    "")
      log "Skipping first tenant scaffold."
      return 0
      ;;
  esac

  tenant_create_cmd="$CLI_BASE_DIR/commands/tenant_create"
  [ -x "$tenant_create_cmd" ] || run_quiet chmod +x "$tenant_create_cmd"

  log "Creating first tenant scaffold for domain '$first_tenant_domain' with host 'www'."
  run_quiet "$tenant_create_cmd" "$first_tenant_domain" -host www
  log "First tenant scaffold created at host 'www.$first_tenant_domain'."
}

grant_project_runtime_access() {
  [ -n "$PROJECT_DIR" ] || return 0
  command -v setfacl >/dev/null 2>&1 || return 0

  local runtime_users=("$EHECOATL_USER" "${DEFAULT_CHILD_USERS[@]}")
  local current_path="$PROJECT_DIR"
  local parent_path
  local runtime_user

  while [ "$current_path" != "/" ]; do
    parent_path="$(dirname "$current_path")"
    [ "$parent_path" = "$current_path" ] && break
    for runtime_user in "${runtime_users[@]}"; do
      run_quiet $SUDO setfacl -m "u:${runtime_user}:x" "$parent_path"
    done
    current_path="$parent_path"
  done

  for runtime_user in "${runtime_users[@]}"; do
    run_quiet $SUDO setfacl -R -m "u:${runtime_user}:rX" "$PROJECT_DIR"
  done
}

# Stage 16: persist installation metadata for uninstall and maintenance scripts.
write_install_metadata() {
  local metadata
  metadata=$(
    cat <<EOF
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
REDIS_PACKAGE_NAME="${EHECOATL_REDIS_PACKAGE_NAME:-}"
REDIS_SERVICE_NAME="${EHECOATL_REDIS_SERVICE_NAME:-}"
REDIS_MANAGED_BY_INSTALLER="${EHECOATL_REDIS_MANAGED_BY_INSTALLER:-0}"
EOF
  )

  run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"
  if ! printf '%s\n' "$metadata" | $SUDO tee "$INSTALL_META_FILE" >/dev/null; then
    fail "Could not write install metadata to $INSTALL_META_FILE"
  fi
  apply_owner_group_mode "$INSTALL_META_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 640
}

verify_setup_state() {
  [ -x "$CLI_TARGET" ] || fail "CLI target not available at $CLI_TARGET"
  [ -d "$PROJECT_DIR/app" ] || fail "Project app directory not found at $PROJECT_DIR/app"
  [ -x "$PROJECT_DIR/setup/setup-ehecoatl.sh" ] || fail "Setup script is not executable at $PROJECT_DIR/setup/setup-ehecoatl.sh"
  [ -x "$PROJECT_DIR/setup/uninstall-ehecoatl.sh" ] || fail "Uninstall script is not executable at $PROJECT_DIR/setup/uninstall-ehecoatl.sh"
  [ -x "$PROJECT_DIR/setup/purge-ehecoatl-data.sh" ] || fail "Purge script is not executable at $PROJECT_DIR/setup/purge-ehecoatl-data.sh"
  $SUDO test -f "$INSTALL_META_FILE" || fail "Install metadata not found at $INSTALL_META_FILE"
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required but unavailable."
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not enabled."
  $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not active."
}

install_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for runtime service setup."
  [ -f "$SYSTEMD_TEMPLATE" ] || fail "Systemd template not found at $SYSTEMD_TEMPLATE"

  local escaped_project_dir
  escaped_project_dir="$(printf '%s\n' "$PROJECT_DIR" | sed 's/[\/&]/\\&/g')"

  if ! sed "s/__PROJECT_DIR__/$escaped_project_dir/g" "$SYSTEMD_TEMPLATE" | $SUDO tee "$SYSTEMD_UNIT_PATH" >/dev/null; then
    fail "Could not write systemd unit at $SYSTEMD_UNIT_PATH"
  fi

  run_quiet $SUDO chmod 644 "$SYSTEMD_UNIT_PATH"
  run_quiet $SUDO systemctl daemon-reload
  run_quiet $SUDO systemctl enable --now "$SYSTEMD_UNIT_NAME"
}

# Stage 1: begin setup and normalize project location.
step "Preparing installation"
log "Installing Ehecoatl..."
parse_args "$@"
maybe_move_to_default_dir

# Stage 2: load policy paths before installation-state checks.
step "Loading runtime policy"
load_runtime_policy

if detect_existing_install; then
  if [ "$FORCE_INSTALL" -eq 0 ]; then
    log "Detected an existing installation. Setup will stop without changes."
    log "Run setup/setup-ehecoatl.sh --force to reapply setup and runtime service provisioning."
    exit 0
  fi
  log "Detected an existing installation; continuing because --force was provided."
fi

# Stage 3.5: clear stale runtime leftovers from previous partial installs before provisioning.
step "Cleaning stale runtime leftovers"
clear_pm2_app_entry
clear_systemd_service_entry
cleanup_stale_cli_target
cleanup_stale_install_metadata

# Stage 8: install system-level dependencies other than Node.js itself.
step "Installing system dependencies"
install_system_dependencies

# Stage 9: stop early when Node.js 24 is not already available.
step "Checking Node.js version"
check_nodejs_24 || fail "Node.js 24 is required."

# Stage 10: install project Node.js dependencies from package.json.
step "Installing Node.js dependencies"
cd "$PROJECT_DIR/app"
run_quiet npm install --silent --no-fund --no-audit

# Stage 11-12: provision the shared runtime user and default child-process users.
step "Creating runtime user"
if ! id "$EHECOATL_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$EHECOATL_USER"
else
  log "System user '$EHECOATL_USER' already exists."
  run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$EHECOATL_USER"
  run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$EHECOATL_USER"
fi

for child_user in "${DEFAULT_CHILD_USERS[@]}"; do
  if ! id "$child_user" >/dev/null 2>&1; then
    run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$child_user"
  else
    log "System user '$child_user' already exists."
    run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$child_user"
    run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$child_user"
  fi
done

# Stage 13: publish the Ehecoatl CLI into the system PATH.
step "Publishing CLI command"
run_quiet $SUDO chmod +x "$CLI_BASE_DIR/ehecoatl"
run_quiet $SUDO ln -sfn "$CLI_BASE_DIR/ehecoatl" "$CLI_TARGET"

# Stage 14-15: create standard directories and apply ownership and permissions.
step "Creating standard directories"
run_quiet $SUDO mkdir -p \
  "$VAR_BASE_DIR/adapters" \
  "$VAR_BASE_DIR/plugins" \
  "$VAR_BASE_DIR/backups" \
  "$VAR_BASE_DIR/cache" \
  "$VAR_BASE_DIR/lib" \
  "$VAR_BASE_DIR/logs" \
  "$VAR_BASE_DIR/spool" \
  "$VAR_BASE_DIR/tenants" \
  "$SRV_BASE_DIR" \
  "$ETC_CONFIG_DIR" \
  "$ETC_ADAPTERS_DIR" \
  "$ETC_PLUGINS_DIR"

step "Setting permissions"
apply_standard_directory_permissions

step "Ensuring maintenance script permissions"
ensure_maintenance_scripts_executable

step "Granting project access"
grant_project_runtime_access

step "Optional first tenant scaffold"
prompt_and_create_first_tenant

# Stage 16: install and enable the systemd runtime service for the main process.
step "Installing runtime service"
install_systemd_service

# Stage 17: write installation metadata after filesystem provisioning succeeds.
step "Writing installation metadata"
write_install_metadata

step "Verifying installation state"
verify_setup_state

# Stage 18: finalize setup output and show follow-up maintenance commands.
step "Finishing"
log "Ehecoatl installed."
log "CLI available at: $CLI_TARGET"
log "Project directory: $PROJECT_DIR"
log "Runtime user: $EHECOATL_USER"
log "Runtime service: $SYSTEMD_UNIT_NAME (enabled and active)"
log "To uninstall binaries/project, run: ./setup/uninstall-ehecoatl.sh"
log "To remove custom data, run: ./setup/purge-ehecoatl-data.sh"
