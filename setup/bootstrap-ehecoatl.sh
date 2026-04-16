#!/bin/bash
set -euo pipefail

# Bootstrap flow:
# 1. Validate that the script is running from a local Ehecoatl checkout.
# 2. Install the local transfer prerequisite (`rsync`) when needed.
# 3. Install Node.js 24 with npm when it is not already available.
# 4. Ensure systemd tooling is available for runtime service management.
# 5. Synchronize only the ehecoatl-runtime payload into the installation directory.
# 6. Mark installed runtime and CLI scripts as executable.
# 7. Log successful bootstrap completion.

INSTALL_DIR="/opt/ehecoatl"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
YES_MODE=0
NON_INTERACTIVE=0
AUTO_INSTALLER=0
COMPLETE_INSTALLER=0
DRY_RUN=0
INSTALLER_PACKAGE_MANAGER=""
INSTALLER_MANAGED_PACKAGES=()
CURRENT_STEP=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() {
  printf '%s[EHECOATL BOOTSTRAP]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"
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
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $*"
    return 0
  fi
  if ! output="$("$@" 2>&1)"; then
    fail "$output"
  fi
}

run_shell_quiet() {
  local output
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] bash -lc $1"
    return 0
  fi
  if ! output="$(bash -lc "$1" 2>&1)"; then
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
      --yes)
        YES_MODE=1
        ;;
      --non-interactive)
        NON_INTERACTIVE=1
        ;;
      --dry-run)
        DRY_RUN=1
        NON_INTERACTIVE=1
        ;;
      --auto-installer)
        AUTO_INSTALLER=1
        ;;
      --complete)
        COMPLETE_INSTALLER=1
        AUTO_INSTALLER=1
        ;;
      *)
        fail "Unknown option: $1"
        ;;
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
    fail "bootstrap-ehecoatl.sh must be run as root or invoked via sudo."
  fi
  fail "bootstrap-ehecoatl.sh must be run as root. sudo is not available on this host."
}

SUDO=""

require_command() {
  command -v "$1" >/dev/null 2>&1
}

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

append_managed_package() {
  local package_name="$1"
  local existing_package

  [ -n "$package_name" ] || return 0

  for existing_package in "${INSTALLER_MANAGED_PACKAGES[@]}"; do
    [ "$existing_package" = "$package_name" ] && return 0
  done

  INSTALLER_MANAGED_PACKAGES+=("$package_name")
}

node_major_version() {
  if ! require_command node; then
    return 1
  fi
  node -p "process.versions.node.split('.')[0]" 2>/dev/null
}

check_nodejs_24() {
  local current_major
  current_major="$(node_major_version || true)"
  [ "$current_major" = "24" ] && require_command npm
}

has_local_project_layout() {
  local candidate_dir="$1"
  [ -d "$candidate_dir/ehecoatl-runtime" ] && [ -f "$candidate_dir/setup/setup-ehecoatl.sh" ]
}

install_nodejs_24() {
  if check_nodejs_24; then
    return 0
  fi

  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
    local preinstalled_ca_certificates=0
    local preinstalled_curl=0
    local preinstalled_gnupg=0
    local preinstalled_apt_transport_https=0
    local preinstalled_nodejs=0

    package_is_installed ca-certificates && preinstalled_ca_certificates=1
    package_is_installed curl && preinstalled_curl=1
    package_is_installed gnupg && preinstalled_gnupg=1
    package_is_installed apt-transport-https && preinstalled_apt_transport_https=1
    package_is_installed nodejs && preinstalled_nodejs=1

    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg apt-transport-https
    if [ -n "$SUDO" ]; then
      run_shell_quiet "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -"
    else
      run_shell_quiet "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -"
    fi
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs

    [ "$preinstalled_ca_certificates" -eq 1 ] || append_managed_package ca-certificates
    [ "$preinstalled_curl" -eq 1 ] || append_managed_package curl
    [ "$preinstalled_gnupg" -eq 1 ] || append_managed_package gnupg
    [ "$preinstalled_apt_transport_https" -eq 1 ] || append_managed_package apt-transport-https
    [ "$preinstalled_nodejs" -eq 1 ] || append_managed_package nodejs
  elif require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
    local preinstalled_nodejs=0
    package_is_installed nodejs && preinstalled_nodejs=1
    if [ -n "$SUDO" ]; then
      run_shell_quiet "curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -"
    else
      run_shell_quiet "curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -"
    fi
    run_quiet $SUDO dnf install -y nodejs
    [ "$preinstalled_nodejs" -eq 1 ] || append_managed_package nodejs
  else
    fail "Node.js 24 with npm is required and could not be installed automatically."
  fi

  check_nodejs_24 || fail "Node.js 24 with npm is required but is still unavailable after installation."
}

ensure_systemd() {
  require_command systemctl || fail "systemd (systemctl) is required for service management."
}

print_dry_run_summary() {
  log "Dry run summary:"
  log "  - Installation source: local checkout at $CHECKOUT_ROOT"
  log "  - Runtime payload source: $CHECKOUT_ROOT/ehecoatl-runtime"
  log "  - Install destination: $INSTALL_DIR"
  log "What may be installed:"
  if ! require_command rsync; then
    log "  - rsync"
  fi
  if ! check_nodejs_24; then
    log "  - Node.js 24.x with npm"
    log "  - curl, gnupg, apt-transport-https or distro equivalents"
  fi
  log "What will be changed:"
  log "  - Validate systemd availability"
  log "  - Synchronize the ehecoatl-runtime payload into $INSTALL_DIR"
  log "  - Ensure installed runtime and packaged CLI scripts are executable under $INSTALL_DIR"
  if [ "$COMPLETE_INSTALLER" -eq 1 ]; then
    log "  - After bootstrap, invoke setup-ehecoatl.sh, then bootstraps/bootstrap-nginx.sh, bootstraps/bootstrap-lets-encrypt.sh, and bootstraps/bootstrap-redis.sh automatically"
  elif [ "$AUTO_INSTALLER" -eq 1 ]; then
    log "  - After bootstrap, invoke setup-ehecoatl.sh automatically"
  fi
}

install_rsync() {
  if require_command rsync; then
    return 0
  fi

  if require_command apt-get; then
    INSTALLER_PACKAGE_MANAGER="apt"
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync
    append_managed_package rsync
    return 0
  fi

  if require_command dnf; then
    INSTALLER_PACKAGE_MANAGER="dnf"
    run_quiet $SUDO dnf install -y rsync
    append_managed_package rsync
    return 0
  fi

  fail "rsync is required and could not be installed automatically."
}

parse_args "$@"
require_root

# Step 1: Validate local checkout availability.
step 1 "Validating local checkout"
[ -d "$CHECKOUT_ROOT" ] || fail "Checkout root not found: $CHECKOUT_ROOT"
has_local_project_layout "$CHECKOUT_ROOT" || fail "No local Ehecoatl checkout found at $CHECKOUT_ROOT. Run setup/downloader-ehecoatl.sh first or run this script from a valid checkout."
log "Using local checkout at $CHECKOUT_ROOT to install into $INSTALL_DIR"

if [ "$DRY_RUN" -eq 1 ]; then
  print_dry_run_summary
  if [ "$AUTO_INSTALLER" -eq 1 ]; then
    dry_run_setup_command="[dry-run] bash $CHECKOUT_ROOT/setup/setup-ehecoatl.sh --dry-run"
    if [ "$YES_MODE" -eq 1 ]; then
      dry_run_setup_command="$dry_run_setup_command --yes"
    fi
    if [ "$NON_INTERACTIVE" -eq 1 ]; then
      dry_run_setup_command="$dry_run_setup_command --non-interactive"
    fi
    log "$dry_run_setup_command"
  fi
  if [ "$COMPLETE_INSTALLER" -eq 1 ]; then
    dry_run_nginx_command="[dry-run] bash $CHECKOUT_ROOT/setup/bootstraps/bootstrap-nginx.sh --dry-run"
    dry_run_lets_encrypt_command="[dry-run] bash $CHECKOUT_ROOT/setup/bootstraps/bootstrap-lets-encrypt.sh --dry-run"
    dry_run_redis_command="[dry-run] bash $CHECKOUT_ROOT/setup/bootstraps/bootstrap-redis.sh --dry-run"
    if [ "$YES_MODE" -eq 1 ]; then
      dry_run_nginx_command="$dry_run_nginx_command --yes"
      dry_run_lets_encrypt_command="$dry_run_lets_encrypt_command --yes"
      dry_run_redis_command="$dry_run_redis_command --yes"
    fi
    if [ "$NON_INTERACTIVE" -eq 1 ]; then
      dry_run_nginx_command="$dry_run_nginx_command --non-interactive"
      dry_run_lets_encrypt_command="$dry_run_lets_encrypt_command --non-interactive"
      dry_run_redis_command="$dry_run_redis_command --non-interactive"
    fi
    log "$dry_run_nginx_command"
    log "$dry_run_lets_encrypt_command"
    log "$dry_run_redis_command"
  fi
  exit 0
fi

# Step 2: Ensure the local-sync prerequisite is available.
step 2 "Checking rsync"
install_rsync

# Step 3: Install the supported Node.js runtime.
step 3 "Installing Node.js 24"
install_nodejs_24

# Step 4: Validate runtime service tooling.
step 4 "Checking systemd availability"
ensure_systemd

# Step 5: Synchronize the ehecoatl-runtime payload into the install directory.
step 5 "Syncing ehecoatl-runtime payload to install directory"
[ -d "$CHECKOUT_ROOT/ehecoatl-runtime" ] || fail "ehecoatl-runtime payload not found at $CHECKOUT_ROOT/ehecoatl-runtime"
[ -n "$INSTALL_DIR" ] || fail "Install directory not defined"

if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  log "Target directory $INSTALL_DIR is not empty and will be synchronized."
  if [ "$NON_INTERACTIVE" -eq 0 ]; then
    read -p "This will overwrite files in $INSTALL_DIR. Continue? [y/N] " confirm
    [ "${confirm:-}" = "y" ] || exit 1
  elif [ "$YES_MODE" -eq 0 ]; then
    fail "Refusing to overwrite non-empty directory without --yes"
  fi
fi
run_quiet $SUDO rsync -a --delete "$CHECKOUT_ROOT/ehecoatl-runtime"/ "$INSTALL_DIR"/

# Step 6: Ensure installed runtime and CLI scripts are executable.
step 6 "Preparing installed runtime scripts"
if [ -f "$INSTALL_DIR/cli/ehecoatl.sh" ]; then
  run_quiet chmod +x "$INSTALL_DIR/cli/ehecoatl.sh"
fi
if [ -d "$INSTALL_DIR/cli/commands" ]; then
  while IFS= read -r cli_script; do
    [ -n "$cli_script" ] || continue
    run_quiet chmod +x "$cli_script"
  done < <(find "$INSTALL_DIR/cli/commands" -maxdepth 1 -type f -name '*.sh' | sort)
fi

# Step 7: Finish the bootstrap flow.
step 7 "Finishing"
log "Ehecoatl bootstrap completed."
if [ "$AUTO_INSTALLER" -eq 1 ]; then
  step 8 "Running setup auto-installer"
  setup_args=()
  if [ "$YES_MODE" -eq 1 ]; then
    setup_args+=("--yes")
  fi
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    setup_args+=("--non-interactive")
  fi
  run_quiet bash "$CHECKOUT_ROOT/setup/setup-ehecoatl.sh" "${setup_args[@]}"
fi

if [ "$COMPLETE_INSTALLER" -eq 1 ]; then
  step 9 "Running complete installer extensions"
  extension_args=()
  if [ "$YES_MODE" -eq 1 ]; then
    extension_args+=("--yes")
  fi
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    extension_args+=("--non-interactive")
  fi
  run_quiet bash "$CHECKOUT_ROOT/setup/bootstraps/bootstrap-nginx.sh" "${extension_args[@]}"
  run_quiet bash "$CHECKOUT_ROOT/setup/bootstraps/bootstrap-lets-encrypt.sh" "${extension_args[@]}"
  run_quiet bash "$CHECKOUT_ROOT/setup/bootstraps/bootstrap-redis.sh" "${extension_args[@]}"
fi

if [ "$AUTO_INSTALLER" -eq 0 ] && [ "$COMPLETE_INSTALLER" -eq 0 ]; then
  log "Run $CHECKOUT_ROOT/setup/setup-ehecoatl.sh to configure the installed runtime at $INSTALL_DIR."
  log "Run $CHECKOUT_ROOT/setup/bootstraps/bootstrap-nginx.sh only when you want a local Nginx installation managed by Ehecoatl."
  log "Run $CHECKOUT_ROOT/setup/bootstraps/bootstrap-lets-encrypt.sh only when you want a local Let's Encrypt client managed by Ehecoatl."
  log "Run $CHECKOUT_ROOT/setup/bootstraps/bootstrap-redis.sh only when you want a local Redis installation managed by Ehecoatl."
fi
