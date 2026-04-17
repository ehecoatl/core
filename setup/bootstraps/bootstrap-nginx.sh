#!/bin/bash
set -eEuo pipefail

# Nginx bootstrap flow:
# 1. Validate that Ehecoatl installation metadata already exists.
# 2. Install a local Nginx package only when required.
# 3. Enable the Nginx service for the managed local installation.
# 4. Disable the distro default site so only managed tenant vhosts stay active.
# 5. Persist Nginx ownership metadata for future uninstall operations.
# 6. Log successful Nginx bootstrap completion.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ETC_BASE_DIR="/etc/opt/ehecoatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
INSTALL_DIR="/opt/ehecoatl"
NGINX_PACKAGE_NAME=""
NGINX_SERVICE_NAME=""
NGINX_MANAGED_BY_INSTALLER=0
EHECOATL_USER="ehecoatl"
DIRECTOR_GROUP="g_directorScope"
NGINX_MANAGED_CONFIG_DIR="/etc/nginx/conf.d/ehecoatl"
NGINX_MANAGED_INCLUDE_FILE="/etc/nginx/conf.d/ehecoatl.conf"
NGINX_MANAGED_CONFIG_MODE="2770"
NGINX_DEFAULT_SITE_ENABLED="/etc/nginx/sites-enabled/default"
CONTRACTS_UTILS_FILE=""
INTERNAL_SSL_ROOT=""
FALLBACK_TLS_CERT=""
FALLBACK_TLS_KEY=""
INSTALL_ROOT="/opt/ehecoatl"
INSTALL_ROOT_MODE="0551"
WELCOME_PAGE_SOURCE="/opt/ehecoatl/welcome-ehecoatl.htm"
WELCOME_PAGE_MODE="0555"
WELCOME_PAGE_TARGET="/var/www/html/index.nginx-debian.html"
INSTALLER_PACKAGE_MANAGER=""
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

log() { printf '%s[EHECOATL BOOTSTRAP NGINX]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
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
trap 'fail "Command failed on line $LINENO while running: ${BASH_COMMAND}"' ERR
print_help() {
  cat <<'EOF'
Usage: setup/bootstraps/bootstrap-nginx.sh [options]

Installs and configures a local Nginx instance for Ehecoatl-managed virtual
hosts when Nginx is intended to be managed on this server.

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
    [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "bootstrap-nginx.sh could not acquire root privileges through sudo."
    exec sudo EHECOATL_SETUP_SUDO_REEXEC=1 bash "$0" "${SCRIPT_ARGS[@]}"
  fi
  fail "bootstrap-nginx.sh must be run as root. sudo is not available on this host."
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
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
ensure_metadata_directory() { run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"; }
resolve_contracts_utils_file() {
  if [ -f "$PROJECT_DIR/ehecoatl-runtime/contracts/utils.js" ]; then
    CONTRACTS_UTILS_FILE="$PROJECT_DIR/ehecoatl-runtime/contracts/utils.js"
    return 0
  fi
  if [ -f "$INSTALL_DIR/contracts/utils.js" ]; then
    CONTRACTS_UTILS_FILE="$INSTALL_DIR/contracts/utils.js"
    return 0
  fi
  fail "Contracts utils.js not found in install directory or source checkout."
}
read_contract_path_entry_field() {
  local layer_key="$1" category="$2" item="$3" field_name="$4"
  node -e '
    const utils = require(process.argv[1]);
    const entry = utils.renderLayerPathEntry(process.argv[2], process.argv[3], process.argv[4], {});
    if (!entry || entry[process.argv[5]] === undefined || entry[process.argv[5]] === null) process.exit(2);
    process.stdout.write(String(entry[process.argv[5]]));
  ' "$CONTRACTS_UTILS_FILE" "$layer_key" "$category" "$item" "$field_name"
}
load_contract_managed_paths() {
  resolve_contracts_utils_file
  INTERNAL_SSL_ROOT="$(read_contract_path_entry_field supervisionScope RUNTIME ssl path)"
  FALLBACK_TLS_CERT="$INTERNAL_SSL_ROOT/generic.fullchain.pem"
  FALLBACK_TLS_KEY="$INTERNAL_SSL_ROOT/generic.privkey.pem"
}
apply_director_group_permissions() {
  run_quiet $SUDO mkdir -p "$NGINX_MANAGED_CONFIG_DIR"
  if command -v setfacl >/dev/null 2>&1; then
    run_quiet $SUDO setfacl -b "$NGINX_MANAGED_CONFIG_DIR"
    run_quiet $SUDO setfacl -k "$NGINX_MANAGED_CONFIG_DIR"
  fi
  run_quiet $SUDO chown "$EHECOATL_USER:$DIRECTOR_GROUP" "$NGINX_MANAGED_CONFIG_DIR"
  run_quiet $SUDO chmod "$NGINX_MANAGED_CONFIG_MODE" "$NGINX_MANAGED_CONFIG_DIR"
}
install_managed_include_file() {
  local include_content
  include_content=$(cat <<EOF_INCLUDE
# Ehecoatl managed nginx include root
include ${NGINX_MANAGED_CONFIG_DIR}/*.conf;
EOF_INCLUDE
)

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write managed include file at $NGINX_MANAGED_INCLUDE_FILE"
    return 0
  fi

  printf '%s\n' "$include_content" | $SUDO tee "$NGINX_MANAGED_INCLUDE_FILE" >/dev/null
  run_quiet $SUDO chown root:root "$NGINX_MANAGED_INCLUDE_FILE"
  run_quiet $SUDO chmod 644 "$NGINX_MANAGED_INCLUDE_FILE"
}
disable_default_nginx_site() {
  if [ ! -e "$NGINX_DEFAULT_SITE_ENABLED" ] && [ ! -L "$NGINX_DEFAULT_SITE_ENABLED" ]; then
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] remove default nginx site at $NGINX_DEFAULT_SITE_ENABLED"
    return 0
  fi

  run_quiet $SUDO rm -f "$NGINX_DEFAULT_SITE_ENABLED"
}
ensure_generic_tls_fallback() {
  local ssl_owner_group=""
  local ssl_parent_root=""
  [ -n "${INTERNAL_SSL_ROOT:-}" ] || fail "Internal SSL root was not resolved from contracts."
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] ensure generic fallback TLS pair at $FALLBACK_TLS_CERT and $FALLBACK_TLS_KEY"
    return 0
  fi

  run_quiet $SUDO mkdir -p "$INTERNAL_SSL_ROOT"
  ssl_owner_group="$($SUDO stat -c '%U:%G' "$INTERNAL_SSL_ROOT")"
  if ! $SUDO test -f "$FALLBACK_TLS_CERT" || ! $SUDO test -f "$FALLBACK_TLS_KEY"; then
    require_command openssl || fail "openssl is required to generate the generic fallback TLS certificate."
    run_quiet $SUDO openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout "$FALLBACK_TLS_KEY" \
      -out "$FALLBACK_TLS_CERT" \
      -days 3650 \
      -subj "/CN=welcome.ehecoatl.internal"
  fi

  run_quiet $SUDO chown "$ssl_owner_group" "$FALLBACK_TLS_CERT" "$FALLBACK_TLS_KEY"
  run_quiet $SUDO chmod 0644 "$FALLBACK_TLS_CERT"
  run_quiet $SUDO chmod 0640 "$FALLBACK_TLS_KEY"

  if command -v setfacl >/dev/null 2>&1; then
    ssl_parent_root="$(dirname "$INTERNAL_SSL_ROOT")"
    run_quiet $SUDO setfacl -m "u:root:--x" "$ssl_parent_root"
    run_quiet $SUDO setfacl -m "u:root:r-x" "$INTERNAL_SSL_ROOT"
    run_quiet $SUDO setfacl -m "u:root:r--" "$FALLBACK_TLS_CERT"
    run_quiet $SUDO setfacl -m "u:root:r--" "$FALLBACK_TLS_KEY"
    run_quiet $SUDO setfacl -m "u:www-data:--x" "$ssl_parent_root"
    run_quiet $SUDO setfacl -m "u:www-data:r-x" "$INTERNAL_SSL_ROOT"
    run_quiet $SUDO setfacl -m "u:www-data:r--" "$FALLBACK_TLS_CERT"
    run_quiet $SUDO setfacl -m "u:www-data:r--" "$FALLBACK_TLS_KEY"
  fi
}
validate_and_reload_nginx() {
  run_quiet $SUDO nginx -t

  if [ -n "${NGINX_SERVICE_NAME:-}" ] && command -v systemctl >/dev/null 2>&1; then
    run_quiet $SUDO systemctl reload "$NGINX_SERVICE_NAME"
    return 0
  fi

  run_quiet $SUDO nginx -s reload
}
resolve_nginx_package_name() {
  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
    printf '%s\n' nginx
    return 0
  fi

  if require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
    printf '%s\n' nginx
    return 0
  fi

  return 1
}

fail_unsupported_nginx_package_manager() {
  fail "Nginx could not be installed automatically on this host because neither apt-get nor dnf is available."
}
resolve_nginx_service_name() {
  if ! require_command systemctl; then
    return 1
  fi
  if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
    printf '%s\n' nginx
    return 0
  fi
  return 1
}
install_nginx() {
  local existing_package_name existing_service_name existing_managed package_name
  existing_package_name="$(read_existing_metadata_value NGINX_PACKAGE_NAME || true)"
  existing_service_name="$(read_existing_metadata_value NGINX_SERVICE_NAME || true)"
  existing_managed="$(read_existing_metadata_value NGINX_MANAGED_BY_INSTALLER || true)"

  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
  elif require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
  fi

  if require_command nginx; then
    NGINX_PACKAGE_NAME="${existing_package_name:-$(resolve_nginx_package_name || true)}"
    NGINX_SERVICE_NAME="${existing_service_name:-$(resolve_nginx_service_name || true)}"
    [ "$existing_managed" = "1" ] && NGINX_MANAGED_BY_INSTALLER=1 || NGINX_MANAGED_BY_INSTALLER=0
    return 0
  fi

  package_name="$(resolve_nginx_package_name)" || fail_unsupported_nginx_package_manager
  NGINX_PACKAGE_NAME="$package_name"

  if [ "$INSTALLER_PACKAGE_MANAGER" = "apt" ]; then
    if package_is_installed "$package_name"; then
      NGINX_MANAGED_BY_INSTALLER=0
      NGINX_SERVICE_NAME="${existing_service_name:-$(resolve_nginx_service_name || true)}"
      return 0
    fi
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$package_name"
  elif [ "$INSTALLER_PACKAGE_MANAGER" = "dnf" ]; then
    if package_is_installed "$package_name"; then
      NGINX_MANAGED_BY_INSTALLER=0
      NGINX_SERVICE_NAME="${existing_service_name:-$(resolve_nginx_service_name || true)}"
      return 0
    fi
    run_quiet $SUDO dnf install -y "$package_name"
  else
    fail_unsupported_nginx_package_manager
  fi

  require_command nginx || fail "Nginx installation finished, but nginx is still unavailable."
  NGINX_MANAGED_BY_INSTALLER=1
}
enable_nginx_service() {
  require_command systemctl || fail "systemctl is required for Nginx service management."
  NGINX_SERVICE_NAME="$(resolve_nginx_service_name || true)"
  [ -n "$NGINX_SERVICE_NAME" ] || fail "An Nginx service unit was not found after installation."
  run_quiet $SUDO systemctl enable --now "$NGINX_SERVICE_NAME"
}
write_install_metadata() {
  local current_project_dir current_default_project_dir current_cli_target current_var_base current_srv_base current_etc_base
  local current_user current_group current_user_created_by_installer current_group_created_by_installer
  local current_install_id current_supervisor_user current_supervisor_group
  local current_supervisor_user_created_by_installer current_supervisor_group_created_by_installer
  local current_director_group current_director_group_created_by_installer
  local current_package_manager current_managed_packages
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
  local lets_encrypt_package_name lets_encrypt_managed_by_installer
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
  redis_package_name="$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)"
  redis_service_name="$(read_existing_metadata_value REDIS_SERVICE_NAME || true)"
  redis_managed_by_installer="$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)"
  redis_supported_major="$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)"
  lets_encrypt_package_name="$(read_existing_metadata_value LETS_ENCRYPT_PACKAGE_NAME || true)"
  lets_encrypt_managed_by_installer="$(read_existing_metadata_value LETS_ENCRYPT_MANAGED_BY_INSTALLER || true)"
  DIRECTOR_GROUP="$(read_existing_metadata_value DIRECTOR_GROUP || true)"
  DIRECTOR_GROUP="${DIRECTOR_GROUP:-g_directorScope}"

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
DIRECTOR_GROUP="${current_director_group:-$DIRECTOR_GROUP}"
DIRECTOR_GROUP_CREATED_BY_INSTALLER="${current_director_group_created_by_installer:-0}"
INSTALLER_PACKAGE_MANAGER="${current_package_manager:-$INSTALLER_PACKAGE_MANAGER}"
INSTALLER_MANAGED_PACKAGES="${current_managed_packages}"
NGINX_PACKAGE_NAME="$NGINX_PACKAGE_NAME"
NGINX_SERVICE_NAME="$NGINX_SERVICE_NAME"
NGINX_MANAGED_BY_INSTALLER="$NGINX_MANAGED_BY_INSTALLER"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
LETS_ENCRYPT_PACKAGE_NAME="${lets_encrypt_package_name:-}"
LETS_ENCRYPT_MANAGED_BY_INSTALLER="${lets_encrypt_managed_by_installer:-0}"
META
)
  ensure_metadata_directory
  if ! printf '%s\n' "$metadata" | $SUDO tee "$INSTALL_META_FILE" >/dev/null; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
}

parse_args "$@"
require_root
load_contract_managed_paths
if $SUDO test -f "$INSTALL_META_FILE"; then
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  eval "$metadata_content"
else
  log "Install metadata not found at $INSTALL_META_FILE. Continuing with pre-setup defaults."
fi
if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run summary:"
  log "What may be installed:"
  log "  - nginx package via the host package manager"
  log "What will be changed:"
  log "  - Enable/start the Nginx service when a local installation is available"
  log "  - Create/update $NGINX_MANAGED_CONFIG_DIR with owner ${EHECOATL_USER:-ehecoatl}, group ${DIRECTOR_GROUP:-g_directorScope}, and mode ${NGINX_MANAGED_CONFIG_MODE}"
  log "  - Create/update $NGINX_MANAGED_INCLUDE_FILE to include ${NGINX_MANAGED_CONFIG_DIR}/*.conf"
  log "  - Disable the distro default nginx site at $NGINX_DEFAULT_SITE_ENABLED"
  log "  - Ensure generic fallback TLS files at $FALLBACK_TLS_CERT and $FALLBACK_TLS_KEY"
  log "  - Validate nginx config and reload nginx"
  log "  - Persist Nginx ownership metadata in $INSTALL_META_FILE"
  exit 0
fi

DIRECTOR_GROUP="${DIRECTOR_GROUP:-$(read_existing_metadata_value DIRECTOR_GROUP || true)}"
DIRECTOR_GROUP="${DIRECTOR_GROUP:-g_directorScope}"
EHECOATL_USER="${EHECOATL_USER:-$(read_existing_metadata_value EHECOATL_USER || true)}"
EHECOATL_USER="${EHECOATL_USER:-ehecoatl}"

# Step 1: Validate the local Nginx bootstrap target.
step 1 "Validating Nginx bootstrap target"
if require_command nginx; then
  log "Detected an existing nginx installation before bootstrap."
fi

# Step 2: Install the Nginx package when required.
step 2 "Installing Nginx"
install_nginx

# Step 3: Enable the Nginx service.
step 3 "Enabling Nginx service"
enable_nginx_service

# Step 4: Prepare nginx managed directory permissions.
step 4 "Preparing managed nginx directory permissions"
apply_director_group_permissions

# Step 5: Install nginx managed include root.
step 5 "Installing managed nginx include"
install_managed_include_file

# Step 6: Disable the distro default site so managed tenants own the edge.
step 6 "Disabling default nginx site"
disable_default_nginx_site

# Step 7: Ensure fallback TLS exists.
step 7 "Ensuring generic fallback TLS"
ensure_generic_tls_fallback

# Step 8: Validate nginx configuration and reload.
step 8 "Validating nginx configuration"
validate_and_reload_nginx

# Step 9: Persist Nginx management metadata.
step 9 "Writing installation metadata"
write_install_metadata

# Step 10: Finish the Nginx bootstrap flow.
step 10 "Finishing"
log "Nginx bootstrap completed."
log "Package: ${NGINX_PACKAGE_NAME:-unknown}"
log "Service: ${NGINX_SERVICE_NAME:-unknown}"
log "Managed by installer: ${NGINX_MANAGED_BY_INSTALLER:-0}"
log "Managed config dir: $NGINX_MANAGED_CONFIG_DIR"
log "Managed include file: $NGINX_MANAGED_INCLUDE_FILE"
log "Director scope group: $DIRECTOR_GROUP"
