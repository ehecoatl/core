#!/bin/bash
set -euo pipefail

# Redis bootstrap flow:
# 1. Resolve installation metadata and initialize Redis defaults.
# 2. Configure logging, failure, argument parsing, and quiet command helpers.
# 3. Resolve whether sudo is needed.
# 4. Enforce the supported Redis major version for local installs.
# 5. Detect an existing compatible Redis installation when already present.
# 6. Install Redis with the host package manager only when missing.
# 7. Enable the Redis service when a local compatible install is available.
# 8. Persist Redis ownership metadata for future uninstall operations.
# 9. Log successful Redis bootstrap completion.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ETC_BASE_DIR="/etc/opt/ehecoatl"
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

log() { printf '[EHECOATL BOOTSTRAP REDIS] %s\n' "$1"; }
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
step() { CURRENT_STEP="$1"; log "$CURRENT_STEP"; }
trap 'fail "Command failed on line $LINENO."' ERR
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --yes) YES_MODE=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;;
      *) fail "Unknown option: $1" ;;
    esac
    shift
  done
}
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to bootstrap Redis."; SUDO="sudo"; fi
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
ensure_metadata_directory() { run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"; }
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
write_install_metadata() {
  local current_project_dir current_default_project_dir current_cli_target current_var_base current_srv_base current_etc_base
  local current_user current_group current_package_manager current_managed_packages
  current_project_dir="$(read_existing_metadata_value PROJECT_DIR || true)"
  current_default_project_dir="$(read_existing_metadata_value DEFAULT_PROJECT_DIR || true)"
  current_cli_target="$(read_existing_metadata_value CLI_TARGET || true)"
  current_var_base="$(read_existing_metadata_value VAR_BASE_DIR || true)"
  current_srv_base="$(read_existing_metadata_value SRV_BASE_DIR || true)"
  current_etc_base="$(read_existing_metadata_value ETC_BASE_DIR || true)"
  current_user="$(read_existing_metadata_value EHECOATL_USER || true)"
  current_group="$(read_existing_metadata_value EHECOATL_GROUP || true)"
  current_package_manager="$(read_existing_metadata_value INSTALLER_PACKAGE_MANAGER || true)"
  current_managed_packages="$(read_existing_metadata_value INSTALLER_MANAGED_PACKAGES || true)"
  local metadata
  metadata=$(cat <<META
PROJECT_DIR="${current_project_dir:-$PROJECT_DIR}"
DEFAULT_PROJECT_DIR="${current_default_project_dir:-/opt/ehecoatl}"
CLI_TARGET="${current_cli_target:-/usr/local/bin/ehecoatl}"
VAR_BASE_DIR="${current_var_base:-/var/opt/ehecoatl}"
SRV_BASE_DIR="${current_srv_base:-/srv/opt/ehecoatl}"
ETC_BASE_DIR="${current_etc_base:-$ETC_BASE_DIR}"
EHECOATL_USER="${current_user:-ehecoatl}"
EHECOATL_GROUP="${current_group:-ehecoatl}"
INSTALLER_PACKAGE_MANAGER="${current_package_manager:-$INSTALLER_PACKAGE_MANAGER}"
INSTALLER_MANAGED_PACKAGES="${current_managed_packages}"
REDIS_PACKAGE_NAME="$REDIS_PACKAGE_NAME"
REDIS_SERVICE_NAME="$REDIS_SERVICE_NAME"
REDIS_MANAGED_BY_INSTALLER="$REDIS_MANAGED_BY_INSTALLER"
REDIS_SUPPORTED_MAJOR="$SUPPORTED_REDIS_MAJOR"
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
if [ "$DRY_RUN" -eq 1 ]; then print_dry_run_summary; exit 0; fi
step "Installing Redis ${SUPPORTED_REDIS_MAJOR}.x"
install_redis
step "Enabling Redis service"
enable_redis_service
step "Writing installation metadata"
write_install_metadata
step "Finishing"
if [ "$REDIS_MANAGED_BY_INSTALLER" = "1" ]; then
  log "Local Redis ${SUPPORTED_REDIS_MAJOR}.x installed and managed by Ehecoatl."
else
  log "Compatible Redis ${SUPPORTED_REDIS_MAJOR}.x already present; ownership remains external."
fi
