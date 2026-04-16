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
# 10. Create the default child-process users declared by policy.
# 11. Publish the Ehecatl CLI symlink in /usr/local/bin.
# 12. Create the standard /var, /srv, and /etc directory layout.
# 13. Apply ownership and permission rules to the standard directories.
# 14. Ensure maintenance scripts remain executable.
# 15. Grant runtime users read and traversal access to the project tree.
# 16. Optionally scaffold the first tenant when running interactively.
# 17. Install and enable the systemd service unit for Ehecatl.
# 18. Write installation metadata to /etc/opt/ehecatl/install-meta.env.
# 19. Verify the final setup state.
# 20. Log final installation status and next-step commands.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_PROJECT_DIR="/opt/ehecatl"
source "$SCRIPT_DIR/lib/runtime-policy.sh"
CLI_BASE_DIR="$PROJECT_DIR/setup/cli"
CLI_TARGET="/usr/local/bin/ehecatl"
SYSTEMD_TEMPLATE="$SCRIPT_DIR/systemd/ehecatl.service"
SYSTEMD_UNIT_NAME="ehecatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
VAR_BASE_DIR="/var/opt/ehecatl"
SRV_BASE_DIR="/srv/opt/ehecatl"
ETC_BASE_DIR="/etc/opt/ehecatl"
ETC_CONFIG_DIR="$ETC_BASE_DIR/config"
ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"
ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
EHECATL_USER="ehecatl"
EHECATL_GROUP="ehecatl"
DEFAULT_CHILD_USERS=("e_manager" "e_engine")
CURRENT_STEP=""
FORCE_INSTALL=0
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[37m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECATL SETUP]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
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
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to install Ehecatl."; SUDO="sudo"; fi
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
  EHECATL_USER="$(policy_value 'system.sharedUser')"; EHECATL_GROUP="$(policy_value 'system.sharedGroup')"
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
apply_standard_directory_permissions() { local managed_dirs=("$VAR_BASE_DIR" "$VAR_BASE_DIR/adapters" "$VAR_BASE_DIR/plugins" "$VAR_BASE_DIR/backups" "$VAR_BASE_DIR/cache" "$VAR_BASE_DIR/lib" "$VAR_BASE_DIR/logs" "$VAR_BASE_DIR/spool" "$VAR_BASE_DIR/tenants" "$SRV_BASE_DIR" "$ETC_BASE_DIR" "$ETC_CONFIG_DIR" "$ETC_ADAPTERS_DIR" "$ETC_PLUGINS_DIR") managed_dir; for managed_dir in "${managed_dirs[@]}"; do apply_owner_group_mode "$managed_dir" "$EHECATL_USER" "$EHECATL_GROUP" 2775; done; }
ensure_maintenance_scripts_executable() { local maintenance_scripts=("$SCRIPT_DIR/bootstrap-system.sh" "$SCRIPT_DIR/bootstrap-redis.sh" "$SCRIPT_DIR/setup-ehecatl.sh" "$SCRIPT_DIR/uninstall-ehecatl.sh" "$SCRIPT_DIR/uninstall-redis.sh" "$SCRIPT_DIR/purge-ehecatl-data.sh") script_path; for script_path in "${maintenance_scripts[@]}"; do [ -f "$script_path" ] || continue; run_quiet $SUDO chmod 775 "$script_path"; done; }
prompt_and_create_first_tenant() {
  local first_tenant_domain tenant_create_cmd
  if [ "$NON_INTERACTIVE" -eq 1 ]; then log "Skipping first tenant scaffold in non-interactive mode."; return 0; fi
  printf 'Enter a first tenant domain to scaffold now (example.com or localhost), or leave blank to skip [skip]: '
  read -r first_tenant_domain
  [ -n "${first_tenant_domain:-}" ] || { log "Skipping first tenant scaffold."; return 0; }
  tenant_create_cmd="$CLI_BASE_DIR/commands/tenant_create.sh"; [ -x "$tenant_create_cmd" ] || run_quiet chmod +x "$tenant_create_cmd"
  log "Creating first tenant scaffold for domain '$first_tenant_domain' with host 'www'."
  run_quiet "$tenant_create_cmd" "$first_tenant_domain" -host www
  log "First tenant scaffold created at host 'www.$first_tenant_domain'."
}
grant_project_runtime_access() {
  [ -n "$PROJECT_DIR" ] || return 0
  command -v setfacl >/dev/null 2>&1 || return 0
  local runtime_users=("$EHECATL_USER" "${DEFAULT_CHILD_USERS[@]}") current_path="$PROJECT_DIR" parent_path runtime_user
  while [ "$current_path" != "/" ]; do parent_path="$(dirname "$current_path")"; [ "$parent_path" = "$current_path" ] && break; for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -m "u:${runtime_user}:x" "$parent_path"; done; current_path="$parent_path"; done
  for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -R -m "u:${runtime_user}:rX" "$PROJECT_DIR"; done
}
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
write_install_metadata() {
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
  redis_package_name="${EHECATL_REDIS_PACKAGE_NAME:-$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)}"
  redis_service_name="${EHECATL_REDIS_SERVICE_NAME:-$(read_existing_metadata_value REDIS_SERVICE_NAME || true)}"
  redis_managed_by_installer="${EHECATL_REDIS_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)}"
  redis_supported_major="${EHECATL_REDIS_SUPPORTED_MAJOR:-$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)}"
  local metadata
  metadata=$(cat <<EOF_META
PROJECT_DIR="$PROJECT_DIR"
DEFAULT_PROJECT_DIR="$DEFAULT_PROJECT_DIR"
CLI_TARGET="$CLI_TARGET"
VAR_BASE_DIR="$VAR_BASE_DIR"
SRV_BASE_DIR="$SRV_BASE_DIR"
ETC_BASE_DIR="$ETC_BASE_DIR"
EHECATL_USER="$EHECATL_USER"
EHECATL_GROUP="$EHECATL_GROUP"
INSTALLER_PACKAGE_MANAGER="${EHECATL_INSTALLER_PACKAGE_MANAGER:-}"
INSTALLER_MANAGED_PACKAGES="${EHECATL_INSTALLER_MANAGED_PACKAGES:-}"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
EOF_META
)
  run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"
  if ! printf '%s\n' "$metadata" | { [ "$DRY_RUN" -eq 1 ] && cat >/dev/null || $SUDO tee "$INSTALL_META_FILE" >/dev/null; }; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
  [ "$DRY_RUN" -eq 1 ] || apply_owner_group_mode "$INSTALL_META_FILE" "$EHECATL_USER" "$EHECATL_GROUP" 640
}
verify_setup_state() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -x "$CLI_TARGET" ] || fail "CLI target not available at $CLI_TARGET"
  [ -d "$PROJECT_DIR/app" ] || fail "Project app directory not found at $PROJECT_DIR/app"
  [ -x "$PROJECT_DIR/setup/setup-ehecatl.sh" ] || fail "Setup script is not executable at $PROJECT_DIR/setup/setup-ehecatl.sh"
  [ -x "$PROJECT_DIR/setup/uninstall-ehecatl.sh" ] || fail "Uninstall script is not executable at $PROJECT_DIR/setup/uninstall-ehecatl.sh"
  [ -x "$PROJECT_DIR/setup/uninstall-redis.sh" ] || fail "Redis uninstall script is not executable at $PROJECT_DIR/setup/uninstall-redis.sh"
  [ -x "$PROJECT_DIR/setup/cli/ehecatl.sh" ] || fail "CLI dispatcher is not executable at $PROJECT_DIR/setup/cli/ehecatl.sh"
  [ -x "$PROJECT_DIR/setup/purge-ehecatl-data.sh" ] || fail "Purge script is not executable at $PROJECT_DIR/setup/purge-ehecatl-data.sh"
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
is_redis_enabled_from_metadata() {
  local redis_managed_by_installer
  redis_managed_by_installer="$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)"
  [ "$redis_managed_by_installer" = "1" ]
}
write_split_json_config() {
  local source_config="$PROJECT_DIR/app/config/default.config.js"
  local target_dir="$ETC_CONFIG_DIR"
  local redis_enabled="0"

  [ -f "$source_config" ] || fail "Default config file not found at $source_config"

  if is_redis_enabled_from_metadata; then
    redis_enabled="1"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FORCE_INSTALL" -eq 1 ]; then
      log "[dry-run] Regenerate all root config JSON files in $target_dir from $source_config"
    else
      log "[dry-run] Create missing root config JSON files in $target_dir from $source_config"
    fi
    if [ "$redis_enabled" = "1" ]; then
      log "[dry-run] Force sharedCacheService.adapter=redis because install metadata indicates Redis is enabled"
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
  if (!config.sharedCacheService || typeof config.sharedCacheService !== "object" || Array.isArray(config.sharedCacheService)) {
    config.sharedCacheService = {};
  }
  config.sharedCacheService.adapter = "redis";
}

fs.mkdirSync(targetDir, { recursive: true });

for (const [key, value] of Object.entries(config)) {
  if (key.startsWith(`_`)) continue;
  const outPath = path.join(targetDir, `${key}.json`);
  if (!forceMode && fs.existsSync(outPath)) continue;

  const json = JSON.stringify(value, null, 2);
  if (typeof json !== "string") {
    console.error(`Root property "${key}" is not JSON-serializable.`);
    process.exit(1);
  }

  fs.writeFileSync(outPath, json + "\n", "utf8");
}
'

  local output
  if ! output="$(node -e "$node_script" "$source_config" "$target_dir" "$FORCE_INSTALL" "$redis_enabled" 2>&1)"; then
    fail "$output"
  fi

  local config_file
  for config_file in "$target_dir"/*.json; do
    [ -e "$config_file" ] || continue
    apply_owner_group_mode "$config_file" "$EHECATL_USER" "$EHECATL_GROUP" 640
  done
}
print_dry_run_summary() {
  log "Dry run summary:"
  log "What may be installed:"
  log "  - python3, make, g++, iptables, acl, curl, ca-certificates when missing"
  log "  - Node.js app dependencies via npm install"
  log "  - system users/groups: $EHECATL_GROUP, $EHECATL_USER, ${DEFAULT_CHILD_USERS[*]}"
  log "What will be changed:"
  log "  - Publish CLI symlink at $CLI_TARGET"
  log "  - Create runtime directories under $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR"
  log "  - Create missing root config JSON files under $ETC_CONFIG_DIR from app/config/default.config.js"
  log "  - With --force, regenerate all root config JSON files under $ETC_CONFIG_DIR"
  log "  - Write/refresh systemd unit at $SYSTEMD_UNIT_PATH"
  log "  - Write install metadata to $INSTALL_META_FILE"
}

# Step 1: Prepare setup execution.
step 1 "Preparing installation"
log "Installing Ehecatl..."
parse_args "$@"

# Step 2: Validate the installation directory.
step 2 "Validating installation directory"
is_project_in_default_dir || fail "Ehecatl setup must be run from $DEFAULT_PROJECT_DIR. Run setup/bootstrap-system.sh first."

# Step 3: Load runtime policy values.
step 3 "Loading runtime policy"
load_runtime_policy
if [ "$DRY_RUN" -eq 1 ]; then print_dry_run_summary; exit 0; fi
if detect_existing_install; then
  if [ "$FORCE_INSTALL" -eq 0 ]; then log "Detected an existing installation. Setup will stop without changes."; log "Run setup/setup-ehecatl.sh --force to reapply setup and runtime service provisioning."; exit 0; fi
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
cd "$PROJECT_DIR/app"
run_quiet npm install --silent --no-fund --no-audit

# Step 8: Create the shared runtime group.
step 8 "Creating runtime group"
if ! getent group "$EHECATL_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$EHECATL_GROUP"
else
  log "System group '$EHECATL_GROUP' already exists."
fi

# Step 9: Create the shared runtime user.
step 9 "Creating runtime user"
if ! id "$EHECATL_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$EHECATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$EHECATL_USER"
else
  log "System user '$EHECATL_USER' already exists."
  run_quiet $SUDO usermod -g "$EHECATL_GROUP" "$EHECATL_USER"
  run_quiet $SUDO usermod -a -G "$EHECATL_GROUP" "$EHECATL_USER"
fi

# Step 10: Create the default child-process users.
step 10 "Creating child process users"
for child_user in "${DEFAULT_CHILD_USERS[@]}"; do
  if ! id "$child_user" >/dev/null 2>&1; then
    run_quiet $SUDO useradd --system --gid "$EHECATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$child_user"
  else
    log "System user '$child_user' already exists."
    run_quiet $SUDO usermod -g "$EHECATL_GROUP" "$child_user"
    run_quiet $SUDO usermod -a -G "$EHECATL_GROUP" "$child_user"
  fi
done

# Step 11: Publish the Ehecatl CLI command.
step 11 "Publishing CLI command"
run_quiet $SUDO chmod +x "$CLI_BASE_DIR/ehecatl.sh"
while IFS= read -r cli_script; do
  [ -n "$cli_script" ] || continue
  run_quiet $SUDO chmod +x "$cli_script"
done < <(find "$CLI_BASE_DIR/commands" -maxdepth 1 -type f -name '*.sh' | sort)
run_quiet $SUDO ln -sfn "$CLI_BASE_DIR/ehecatl.sh" "$CLI_TARGET"

# Step 12: Create the standard runtime directories.
step 12 "Creating standard directories"
run_quiet $SUDO mkdir -p "$VAR_BASE_DIR/adapters" "$VAR_BASE_DIR/plugins" "$VAR_BASE_DIR/backups" "$VAR_BASE_DIR/cache" "$VAR_BASE_DIR/lib" "$VAR_BASE_DIR/logs" "$VAR_BASE_DIR/spool" "$VAR_BASE_DIR/tenants" "$SRV_BASE_DIR" "$ETC_CONFIG_DIR" "$ETC_ADAPTERS_DIR" "$ETC_PLUGINS_DIR"
log "Writing split JSON configuration"
write_split_json_config

# Step 13: Apply ownership and permissions.
step 13 "Setting permissions"
apply_standard_directory_permissions

# Step 14: Ensure maintenance scripts remain executable.
step 14 "Ensuring maintenance script permissions"
ensure_maintenance_scripts_executable

# Step 15: Grant runtime users access to the project tree.
step 15 "Granting project access"
grant_project_runtime_access

# Step 16: Optionally scaffold the first tenant.
step 16 "Optional first tenant scaffold"
prompt_and_create_first_tenant

# Step 17: Install the runtime service.
step 17 "Installing runtime service"
install_systemd_service

# Step 18: Write installation metadata.
step 18 "Writing installation metadata"
write_install_metadata

# Step 19: Verify the final setup state.
step 19 "Verifying setup state"
verify_setup_state

# Step 20: Finish the setup flow.
step 20 "Finishing"
log "Ehecatl installed successfully."
log "Use 'ehecatl start' to launch manually when needed."
log "Use setup/bootstrap-redis.sh only when you want Ehecatl to manage a local Redis ${EHECATL_REDIS_SUPPORTED_MAJOR:-7}.x installation."
