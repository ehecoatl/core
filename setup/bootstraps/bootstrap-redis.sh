#!/bin/bash
set -eEuo pipefail

# Redis bootstrap flow:
# 1. Validate the local Redis installation target and supported major version.
# 2. Install a compatible local Redis package only when required.
# 3. Enable the Redis service for the managed local installation.
# 4. Update adapters.json so the shared cache adapter becomes Redis.
# 5. Persist Redis ownership metadata for future uninstall operations.
# 6. Log successful Redis bootstrap completion.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ETC_BASE_DIR="/etc/opt/ehecoatl"
ETC_CONFIG_DIR="$ETC_BASE_DIR/config"
ADAPTERS_CONFIG_DIR="$ETC_CONFIG_DIR/adapters"
ADAPTERS_CONFIG_FILE="$ADAPTERS_CONFIG_DIR/sharedCacheService.json"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
SUPPORTED_REDIS_MAJOR="${EHECOATL_REDIS_MAJOR:-7}"
REDIS_PACKAGE_NAME=""
REDIS_SERVICE_NAME=""
REDIS_MANAGED_BY_INSTALLER=0
INSTALLER_PACKAGE_MANAGER=""
INSTALLER_MANAGED_PACKAGES=()
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
CURRENT_STEP=""
SCRIPT_ARGS=("$@")

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECOATL BOOTSTRAP REDIS]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail() {
  printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2
  [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2
  exit 1
}
run_quiet() {
  local output
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $*"
    return 0
  fi
  if ! output="$("$@" 2>&1)"; then
    fail "$output"
  fi
}
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR
print_help() {
  cat <<'EOF'
Usage: setup/bootstraps/bootstrap-redis.sh [options]

Installs and enables a local Redis instance and switches the shared cache
adapter to Redis when Redis is intended to be managed on this server.

Options:
  --yes               Accept confirmation prompts automatically.
  --non-interactive   Disable interactive prompts.
  --dry-run           Print planned actions without executing them.
  -h, --help          Show this help message.
EOF
}
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) print_help; exit 0 ;;
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
    [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "bootstrap-redis.sh could not acquire root privileges through sudo."
    exec sudo EHECOATL_SETUP_SUDO_REEXEC=1 bash "$0" "${SCRIPT_ARGS[@]}"
  fi
  fail "bootstrap-redis.sh must be run as root. sudo is not available on this host."
}
SUDO=""
require_command() { command -v "$1" >/dev/null 2>&1; }
append_managed_package() {
  local package_name="$1" existing_package
  [ -n "$package_name" ] || return 0
  for existing_package in "${INSTALLER_MANAGED_PACKAGES[@]}"; do [ "$existing_package" = "$package_name" ] && return 0; done
  INSTALLER_MANAGED_PACKAGES+=("$package_name")
}
redis_server_command() { if require_command redis-server; then printf '%s\n' redis-server; return 0; fi; [ -x /usr/sbin/redis-server ] && printf '%s\n' /usr/sbin/redis-server || return 1; }
redis_major_version() { local redis_cmd version_string; redis_cmd="$(redis_server_command)" || return 1; version_string="$($redis_cmd --version 2>/dev/null | sed -n 's/.*v=\([0-9][0-9]*\)\..*/\1/p' | head -n 1)"; [ -n "$version_string" ] || return 1; printf '%s\n' "$version_string"; }
check_supported_redis_major() { local current_major; current_major="$(redis_major_version || true)"; [ "$current_major" = "$SUPPORTED_REDIS_MAJOR" ]; }
resolve_redis_service_name() {
  if ! require_command systemctl; then return 1; fi
  if systemctl list-unit-files redis-server.service >/dev/null 2>&1; then printf '%s\n' redis-server; return 0; fi
  if systemctl list-unit-files redis.service >/dev/null 2>&1; then printf '%s\n' redis; return 0; fi
  return 1
}
enable_redis_service() {
  if ! require_command systemctl; then return 0; fi
  REDIS_SERVICE_NAME="$(resolve_redis_service_name || true)"
  [ -n "$REDIS_SERVICE_NAME" ] || fail "A Redis service unit was not found after installation."
  run_quiet $SUDO systemctl enable --now "$REDIS_SERVICE_NAME"
}
install_redis() {
  if check_supported_redis_major; then
    if require_command apt-get; then INSTALLER_PACKAGE_MANAGER="apt"; REDIS_PACKAGE_NAME="redis-server"; elif require_command dnf; then INSTALLER_PACKAGE_MANAGER="dnf"; REDIS_PACKAGE_NAME="redis"; fi
    REDIS_MANAGED_BY_INSTALLER=0
    return 0
  fi
  if require_command redis-server || [ -x /usr/sbin/redis-server ]; then
    fail "A Redis installation was found, but its major version is not supported. Ehecoatl local Redis bootstrap currently supports only Redis ${SUPPORTED_REDIS_MAJOR}.x. Use a compatible existing Redis installation or provision Redis outside the bootstrap flow."
  fi
  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
    REDIS_PACKAGE_NAME="redis-server"
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq redis-server
  elif require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
    REDIS_PACKAGE_NAME="redis"
    run_quiet $SUDO dnf install -y redis
  else
    fail "Redis could not be installed automatically on this host."
  fi
  check_supported_redis_major || fail "Redis installed successfully but the detected major version is not ${SUPPORTED_REDIS_MAJOR}.x. Ehecoatl local Redis bootstrap only supports Redis ${SUPPORTED_REDIS_MAJOR}.x."
  REDIS_MANAGED_BY_INSTALLER=1
  append_managed_package "$REDIS_PACKAGE_NAME"
}
write_shared_cache_service_config() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] ensure $ADAPTERS_CONFIG_FILE contains adapter=redis"
    return 0
  fi

  run_quiet $SUDO mkdir -p "$ADAPTERS_CONFIG_DIR"

  local node_script
  node_script='
const fs = require("fs");
const configFile = process.argv[1];

let data = {};
if (fs.existsSync(configFile)) {
  const raw = fs.readFileSync(configFile, "utf8").trim();
  if (raw) { data = JSON.parse(raw); }
}

if (!data || typeof data !== "object" || Array.isArray(data)) { data = {}; }
data.adapter = "redis";
fs.writeFileSync(configFile, JSON.stringify(data, null, 2) + "\n", "utf8");
'

  local output
  if ! output="$(node -e "$node_script" "$ADAPTERS_CONFIG_FILE" 2>&1)"; then
    fail "$output"
  fi
}
ensure_metadata_directory() { run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"; }
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
write_install_metadata() {
  local current_project_dir current_default_project_dir current_cli_target current_var_base current_srv_base current_etc_base
  local current_user current_group current_user_created_by_installer current_group_created_by_installer
  local current_install_id current_supervisor_user current_supervisor_group
  local current_supervisor_user_created_by_installer current_supervisor_group_created_by_installer
  local current_director_group current_director_group_created_by_installer
  local nginx_package_name nginx_service_name nginx_managed_by_installer
  local current_package_manager current_managed_packages lets_encrypt_package_name lets_encrypt_managed_by_installer
  current_project_dir="$(read_existing_metadata_value PROJECT_DIR || true)"
  current_default_project_dir="$(read_existing_metadata_value DEFAULT_PROJECT_DIR || true)"
  current_cli_target="$(read_existing_metadata_value CLI_TARGET || true)"
  current_var_base="$(read_existing_metadata_value VAR_BASE_DIR || true)"
  current_srv_base="$(read_existing_metadata_value SRV_BASE_DIR || true)"
  current_etc_base="$(read_existing_metadata_value ETC_BASE_DIR || true)"
  current_user="$(read_existing_metadata_value EHECOATL_USER || true)"
  current_group="$(read_existing_metadata_value EHECOATL_GROUP || true)"
  current_user_created_by_installer="$(read_existing_metadata_value EHECOATL_USER_CREATED_BY_INSTALLER || true)"
  current_group_created_by_installer="$(read_existing_metadata_value EHECOATL_GROUP_CREATED_BY_INSTALLER || true)"
  current_install_id="$(read_existing_metadata_value INSTALL_ID || true)"
  current_supervisor_user="$(read_existing_metadata_value SUPERVISOR_USER || true)"
  current_supervisor_group="$(read_existing_metadata_value SUPERVISOR_GROUP || true)"
  current_supervisor_user_created_by_installer="$(read_existing_metadata_value SUPERVISOR_USER_CREATED_BY_INSTALLER || true)"
  current_supervisor_group_created_by_installer="$(read_existing_metadata_value SUPERVISOR_GROUP_CREATED_BY_INSTALLER || true)"
  current_director_group="$(read_existing_metadata_value DIRECTOR_GROUP || true)"
  current_director_group_created_by_installer="$(read_existing_metadata_value DIRECTOR_GROUP_CREATED_BY_INSTALLER || true)"
  current_package_manager="$(read_existing_metadata_value INSTALLER_PACKAGE_MANAGER || true)"
  current_managed_packages="$(read_existing_metadata_value INSTALLER_MANAGED_PACKAGES || true)"
  nginx_package_name="$(read_existing_metadata_value NGINX_PACKAGE_NAME || true)"
  nginx_service_name="$(read_existing_metadata_value NGINX_SERVICE_NAME || true)"
  nginx_managed_by_installer="$(read_existing_metadata_value NGINX_MANAGED_BY_INSTALLER || true)"
  lets_encrypt_package_name="$(read_existing_metadata_value LETS_ENCRYPT_PACKAGE_NAME || true)"
  lets_encrypt_managed_by_installer="$(read_existing_metadata_value LETS_ENCRYPT_MANAGED_BY_INSTALLER || true)"
  local metadata
  metadata=$(cat <<META
PROJECT_DIR="${current_project_dir:-/opt/ehecoatl}"
DEFAULT_PROJECT_DIR="${current_default_project_dir:-/opt/ehecoatl}"
CLI_TARGET="${current_cli_target:-/usr/local/bin/ehecoatl}"
VAR_BASE_DIR="${current_var_base:-/var/opt/ehecoatl}"
SRV_BASE_DIR="${current_srv_base:-/srv/opt/ehecoatl}"
ETC_BASE_DIR="${current_etc_base:-$ETC_BASE_DIR}"
EHECOATL_USER="${current_user:-ehecoatl}"
EHECOATL_GROUP="${current_group:-ehecoatl}"
EHECOATL_USER_CREATED_BY_INSTALLER="${current_user_created_by_installer:-0}"
EHECOATL_GROUP_CREATED_BY_INSTALLER="${current_group_created_by_installer:-0}"
INSTALL_ID="${current_install_id:-}"
SUPERVISOR_USER="${current_supervisor_user:-}"
SUPERVISOR_GROUP="${current_supervisor_group:-g_superScope}"
SUPERVISOR_USER_CREATED_BY_INSTALLER="${current_supervisor_user_created_by_installer:-0}"
SUPERVISOR_GROUP_CREATED_BY_INSTALLER="${current_supervisor_group_created_by_installer:-0}"
DIRECTOR_GROUP="${current_director_group:-g_directorScope}"
DIRECTOR_GROUP_CREATED_BY_INSTALLER="${current_director_group_created_by_installer:-0}"
INSTALLER_PACKAGE_MANAGER="${current_package_manager:-$INSTALLER_PACKAGE_MANAGER}"
INSTALLER_MANAGED_PACKAGES="${current_managed_packages}"
NGINX_PACKAGE_NAME="${nginx_package_name:-}"
NGINX_SERVICE_NAME="${nginx_service_name:-}"
NGINX_MANAGED_BY_INSTALLER="${nginx_managed_by_installer:-0}"
REDIS_PACKAGE_NAME="$REDIS_PACKAGE_NAME"
REDIS_SERVICE_NAME="$REDIS_SERVICE_NAME"
REDIS_MANAGED_BY_INSTALLER="$REDIS_MANAGED_BY_INSTALLER"
REDIS_SUPPORTED_MAJOR="$SUPPORTED_REDIS_MAJOR"
LETS_ENCRYPT_PACKAGE_NAME="${lets_encrypt_package_name:-}"
LETS_ENCRYPT_MANAGED_BY_INSTALLER="${lets_encrypt_managed_by_installer:-0}"
META
)
  ensure_metadata_directory
  if ! printf '%s\n' "$metadata" | $SUDO tee "$INSTALL_META_FILE" >/dev/null; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
}
print_dry_run_summary() {
  log "Dry run summary:"
  log "  - Supported local Redis major: ${SUPPORTED_REDIS_MAJOR}.x only"
  if current_major="$(redis_major_version || true)"; then
    log "  - Detected existing Redis major: $current_major"
  else
    log "  - Detected existing Redis major: none"
  fi
  log "What may be installed:"
  log "  - redis-server or redis package only when a compatible local Redis is missing"
  log "What will be changed:"
  log "  - Enable/start local Redis service when compatible"
  log "  - Write Redis ownership metadata to $INSTALL_META_FILE"
}

parse_args "$@"
require_root
if $SUDO test -f "$INSTALL_META_FILE"; then
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  eval "$metadata_content"
else
  log "Install metadata not found at $INSTALL_META_FILE. Continuing with pre-setup defaults."
fi
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run summary:"
    log "What may be installed:"
    log "  - Redis ${SUPPORTED_REDIS_MAJOR}.x package via the host package manager"
    log "What will be changed:"
    log "  - Enable/start Redis service when a compatible local installation is available"
    log "  - Persist Redis ownership metadata in $INSTALL_META_FILE"
    log "  - Ensure $ADAPTERS_CONFIG_FILE uses sharedCacheService.adapter=redis while preserving other JSON properties"
    exit 0
  fi

# Step 1: Validate the local Redis installation target.
step 1 "Validating Redis installation target"
[ -n "$SUPPORTED_REDIS_MAJOR" ] || fail "A supported Redis major version must be defined."
[ "$SUPPORTED_REDIS_MAJOR" = "7" ] || fail "Local Redis installation is restricted to Redis 7.x for this release."
if current_major="$(redis_major_version || true)"; then
  log "Detected Redis major before bootstrap: $current_major"
fi

# Step 2: Install a compatible local Redis package when required.
step 2 "Installing Redis ${SUPPORTED_REDIS_MAJOR}.x"
install_redis

# Step 3: Enable the managed Redis service.
step 3 "Enabling Redis service"
enable_redis_service

# Step 4: Update the shared cache configuration for Redis.
step 4 "Writing shared cache configuration"
write_shared_cache_service_config

# Step 5: Persist Redis management metadata.
step 5 "Writing installation metadata"
write_install_metadata

# Step 6: Finish the Redis bootstrap flow.
step 6 "Finishing"
log "Redis bootstrap completed."
log "Redis package: ${REDIS_PACKAGE_NAME:-unknown}"
log "Redis service: ${REDIS_SERVICE_NAME:-unknown}"
log "Managed by installer: ${REDIS_MANAGED_BY_INSTALLER:-0}"
