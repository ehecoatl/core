#!/bin/bash
set -euo pipefail

# Let's Encrypt bootstrap flow:
# 1. Validate that Ehecoatl installation metadata already exists.
# 2. Install a local Let's Encrypt client only when required.
# 3. Persist Let's Encrypt ownership metadata for future uninstall operations.
# 4. Log successful Let's Encrypt bootstrap completion.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ETC_BASE_DIR="/etc/opt/ehecoatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
LETS_ENCRYPT_PACKAGE_NAME=""
LETS_ENCRYPT_MANAGED_BY_INSTALLER=0
INSTALLER_PACKAGE_MANAGER=""
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
CURRENT_STEP=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECOATL BOOTSTRAP LETS ENCRYPT]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
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
require_root() {
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    fail "bootstrap-lets-encrypt.sh must be run as root or invoked via sudo."
  fi
  fail "bootstrap-lets-encrypt.sh must be run as root. sudo is not available on this host."
}
SUDO=""
require_command() { command -v "$1" >/dev/null 2>&1; }
package_is_installed() {
  local package_name="$1"

  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q 'install ok installed'
    return $?
  fi

  if command -v rpm >/dev/null 2>&1; then
    rpm -q "$package_name" >/dev/null 2>&1
    return $?
  fi

  return 1
}
package_is_available() {
  local package_name="$1"
  if [ -z "$package_name" ]; then
    return 1
  fi

  if require_command apt-cache; then
    apt-cache policy "$package_name" 2>/dev/null | grep -q 'Candidate: (none)' && return 1
    apt-cache show "$package_name" >/dev/null 2>&1
    return $?
  fi

  if require_command dnf; then
    dnf info "$package_name" >/dev/null 2>&1
    return $?
  fi

  return 1
}
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
ensure_metadata_directory() { run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"; }
resolve_lets_encrypt_package_name() {
  if require_command apt-get; then
    if package_is_available letsencrypt; then
      printf '%s\n' "certbot letsencrypt"
      return 0
    fi
    printf '%s\n' "certbot"
    return 0
  fi

  if require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
    if package_is_available letsencrypt; then
      printf '%s\n' "certbot letsencrypt"
      return 0
    fi
    printf '%s\n' "certbot"
    return 0
  fi

  return 1
}
install_lets_encrypt() {
  local existing_package_name existing_managed package_name package_entry missing_packages=() any_missing=0
  existing_package_name="$(read_existing_metadata_value LETS_ENCRYPT_PACKAGE_NAME || true)"
  existing_managed="$(read_existing_metadata_value LETS_ENCRYPT_MANAGED_BY_INSTALLER || true)"
  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
  elif require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
  else
    fail "Let's Encrypt could not be installed automatically on this host."
  fi
  package_name="$(resolve_lets_encrypt_package_name)" || fail "Let's Encrypt could not be installed automatically on this host."

  for package_entry in $package_name; do
    if ! package_is_installed "$package_entry"; then
      missing_packages+=("$package_entry")
      any_missing=1
    fi
  done

  if require_command certbot && [ "$any_missing" -eq 0 ]; then
    LETS_ENCRYPT_PACKAGE_NAME="${existing_package_name:-$package_name}"
    [ "$existing_managed" = "1" ] && LETS_ENCRYPT_MANAGED_BY_INSTALLER=1 || LETS_ENCRYPT_MANAGED_BY_INSTALLER=0
    return 0
  fi

  LETS_ENCRYPT_PACKAGE_NAME="$package_name"

  if [ "$INSTALLER_PACKAGE_MANAGER" = "apt" ]; then
    [ "${#missing_packages[@]}" -gt 0 ] || missing_packages=(certbot)
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing_packages[@]}"
  elif [ "$INSTALLER_PACKAGE_MANAGER" = "dnf" ]; then
    [ "${#missing_packages[@]}" -gt 0 ] || missing_packages=(certbot)
    run_quiet $SUDO dnf install -y "${missing_packages[@]}"
  else
    fail "Let's Encrypt could not be installed automatically on this host."
  fi

  require_command certbot || fail "Let's Encrypt client installation finished, but certbot is still unavailable."
  LETS_ENCRYPT_MANAGED_BY_INSTALLER=1
}
write_install_metadata() {
  local current_project_dir current_default_project_dir current_cli_target current_var_base current_srv_base current_etc_base
  local current_user current_group current_user_created_by_installer current_group_created_by_installer
  local current_package_manager current_managed_packages
  local nginx_package_name nginx_service_name nginx_managed_by_installer
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
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
  current_package_manager="$(read_existing_metadata_value INSTALLER_PACKAGE_MANAGER || true)"
  current_managed_packages="$(read_existing_metadata_value INSTALLER_MANAGED_PACKAGES || true)"
  nginx_package_name="$(read_existing_metadata_value NGINX_PACKAGE_NAME || true)"
  nginx_service_name="$(read_existing_metadata_value NGINX_SERVICE_NAME || true)"
  nginx_managed_by_installer="$(read_existing_metadata_value NGINX_MANAGED_BY_INSTALLER || true)"
  redis_package_name="$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)"
  redis_service_name="$(read_existing_metadata_value REDIS_SERVICE_NAME || true)"
  redis_managed_by_installer="$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)"
  redis_supported_major="$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)"

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
EHECOATL_USER_CREATED_BY_INSTALLER="${current_user_created_by_installer:-0}"
EHECOATL_GROUP_CREATED_BY_INSTALLER="${current_group_created_by_installer:-0}"
INSTALLER_PACKAGE_MANAGER="${current_package_manager:-$INSTALLER_PACKAGE_MANAGER}"
INSTALLER_MANAGED_PACKAGES="${current_managed_packages}"
NGINX_PACKAGE_NAME="${nginx_package_name:-}"
NGINX_SERVICE_NAME="${nginx_service_name:-}"
NGINX_MANAGED_BY_INSTALLER="${nginx_managed_by_installer:-0}"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
LETS_ENCRYPT_PACKAGE_NAME="$LETS_ENCRYPT_PACKAGE_NAME"
LETS_ENCRYPT_MANAGED_BY_INSTALLER="$LETS_ENCRYPT_MANAGED_BY_INSTALLER"
META
)
  ensure_metadata_directory
  if ! printf '%s\n' "$metadata" | $SUDO tee "$INSTALL_META_FILE" >/dev/null; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
}

parse_args "$@"
require_root
if ! $SUDO test -f "$INSTALL_META_FILE"; then fail "Install metadata was not found at $INSTALL_META_FILE. Run setup/setup-ehecoatl.sh first."; fi
metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"
if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run summary:"
  log "What may be installed:"
  log "  - certbot package via the host package manager"
  log "  - letsencrypt package when the host repository provides it"
  log "What will be changed:"
  log "  - Persist Let's Encrypt ownership metadata in $INSTALL_META_FILE"
  exit 0
fi

# Step 1: Validate the local Let's Encrypt bootstrap target.
step 1 "Validating Let's Encrypt bootstrap target"
if require_command certbot; then
  log "Detected an existing certbot installation before bootstrap."
fi

# Step 2: Install the Let's Encrypt client when required.
step 2 "Installing Let's Encrypt client"
install_lets_encrypt

# Step 3: Persist Let's Encrypt management metadata.
step 3 "Writing installation metadata"
write_install_metadata

# Step 4: Finish the Let's Encrypt bootstrap flow.
step 4 "Finishing"
log "Let's Encrypt bootstrap completed."
log "Package: ${LETS_ENCRYPT_PACKAGE_NAME:-unknown}"
log "Managed by installer: ${LETS_ENCRYPT_MANAGED_BY_INSTALLER:-0}"
