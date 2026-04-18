#!/bin/bash
set -euo pipefail

# Bootstrap flow:
# 1. Define installation target and repository source.
# 2. Configure logging, failure, argument parsing, and quiet command helpers.
# 3. Resolve whether sudo is needed.
# 4. Detect whether the bootstrap launcher is already running from a local checkout.
# 5. Ensure git is available when a repository clone is still required.
# 6. Install Node.js 24 with npm when it is not already available.
# 7. Ensure systemd tooling is available for runtime service management.
# 8. Validate the installation target directory when a clone is required.
# 9. Create the installation directory and assign local ownership.
# 10. Initialize a git repository in the target directory.
# 11. Add the remote origin for the Ehecoatl repository.
# 12. Fetch tags and remote references from origin.
# 13. Checkout the latest release tag when available.
# 14. Fallback to the default branch when no tag exists.
# 15. Mark setup scripts as executable.
# 16. Log successful bootstrap completion.

INSTALL_DIR="/opt/ehecoatl"
REPO_URL="${EHECOATL_REPO_URL:-https://github.com/braxismedia/ehecoatl.git}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
USE_LOCAL_CHECKOUT=0
FORCE_SETUP=0
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
INSTALLER_PACKAGE_MANAGER=""
INSTALLER_MANAGED_PACKAGES=()
CURRENT_STEP=""

log() {
  printf '[EHECOATL BOOTSTRAP SYSTEM] %s\n' "$1"
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
  CURRENT_STEP="$1"
  log "$CURRENT_STEP"
}

trap 'fail "Command failed on line $LINENO."' ERR

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force)
        FORCE_SETUP=1
        ;;
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
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to run the bootstrap script."
  SUDO="sudo"
fi

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
  [ -d "$candidate_dir/app" ] && [ -f "$candidate_dir/setup/setup-ehecoatl.sh" ]
}

install_git() {
  if require_command git; then
    return 0
  fi

  if require_command apt-get; then
    local preinstalled_git=0
    local preinstalled_ca_certificates=0
    package_is_installed git && preinstalled_git=1
    package_is_installed ca-certificates && preinstalled_ca_certificates=1
    INSTALLER_PACKAGE_MANAGER="apt"
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates
    [ "$preinstalled_git" -eq 1 ] || append_managed_package git
    [ "$preinstalled_ca_certificates" -eq 1 ] || append_managed_package ca-certificates
    return 0
  fi

  if require_command dnf; then
    local preinstalled_git=0
    local preinstalled_ca_certificates=0
    package_is_installed git && preinstalled_git=1
    package_is_installed ca-certificates && preinstalled_ca_certificates=1
    INSTALLER_PACKAGE_MANAGER="dnf"
    run_quiet $SUDO dnf install -y git ca-certificates
    [ "$preinstalled_git" -eq 1 ] || append_managed_package git
    [ "$preinstalled_ca_certificates" -eq 1 ] || append_managed_package ca-certificates
    return 0
  fi

  fail "git is required and could not be installed automatically."
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
  if [ "$USE_LOCAL_CHECKOUT" -eq 1 ]; then
    log "  - Installation source: existing checkout at $CHECKOUT_ROOT"
    log "  - Will be cloned to $INSTALL_DIR"
  else
    log "  - Installation source: clone repository into $INSTALL_DIR"
    log "  - Repository URL: $REPO_URL"
  fi
  log "What may be installed:"
  if [ "$USE_LOCAL_CHECKOUT" -eq 1 ] && ! require_command rsync; then
    log "  - rsync"
  fi
  if [ "$USE_LOCAL_CHECKOUT" -eq 0 ] && ! require_command git; then
    log "  - git"
    log "  - ca-certificates"
  fi
  if ! check_nodejs_24; then
    log "  - Node.js 24.x with npm"
    log "  - curl, gnupg, apt-transport-https or distro equivalents"
  fi
  log "What will be changed:"
  log "  - Validate systemd availability"
  if [ "$USE_LOCAL_CHECKOUT" -eq 0 ]; then
    log "  - Create $INSTALL_DIR"
    log "  - Initialize git repository and fetch latest release"
  fi
  log "  - Ensure setup scripts are executable under $INSTALL_DIR/setup"
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

step "Detecting installation source"

if has_local_project_layout "$CHECKOUT_ROOT"; then
  USE_LOCAL_CHECKOUT=1
  log "Using local checkout at $CHECKOUT_ROOT to install into $INSTALL_DIR"
else
  log "No local checkout detected beside setup/bootstrap-system.sh; clone flow will use $INSTALL_DIR"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  print_dry_run_summary
  exit 0
fi

if [ "$USE_LOCAL_CHECKOUT" -eq 1 ]; then
  step "Checking rsync"
  install_rsync
elif [ "$USE_LOCAL_CHECKOUT" -eq 0 ]; then
  step "Checking git"
  install_git
fi

step "Installing Node.js 24"
install_nodejs_24

step "Checking systemd availability"
ensure_systemd

if [ "$USE_LOCAL_CHECKOUT" -eq 1 ]; then
  step "Syncing project files to install directory"
  [ -d "$CHECKOUT_ROOT" ] || fail "Checkout root not found: $CHECKOUT_ROOT"
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
  run_quiet $SUDO rsync -a --delete --exclude '.git' "$CHECKOUT_ROOT"/ "$INSTALL_DIR"/

elif [ "$USE_LOCAL_CHECKOUT" -eq 0 ]; then
  step "Preparing installation directory"
  if [ -e "$INSTALL_DIR/.git" ]; then
    fail "Target already contains a git repository at $INSTALL_DIR"
  fi
  if [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    fail "Target directory $INSTALL_DIR already exists and is not empty. Use a clean directory or remove it before running bootstrap."
  fi

  run_quiet $SUDO mkdir -p "$INSTALL_DIR"
  run_quiet $SUDO chown "$(id -un)":"$(id -gn)" "$INSTALL_DIR"

  step "Initializing repository"
  cd "$INSTALL_DIR"
  run_quiet git init -q
  run_quiet git remote add origin "$REPO_URL"

  step "Downloading latest release"
  run_quiet git fetch --tags --force origin

  LATEST_TAG="$(git for-each-ref --sort=-creatordate --format='%(refname:short)' refs/tags | head -n 1)"

  if [ -n "$LATEST_TAG" ]; then
    run_quiet git checkout -q "tags/$LATEST_TAG"
  else
    DEFAULT_BRANCH="$(git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p' | head -n 1)"
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    run_quiet git fetch --depth 1 origin "$DEFAULT_BRANCH"
    run_quiet git checkout -q -b "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"
  fi
fi

step "Preparing project setup scripts"
run_quiet chmod +x "$INSTALL_DIR/setup/bootstrap-system.sh"
if [ -f "$INSTALL_DIR/setup/bootstrap-redis.sh" ]; then
  run_quiet chmod +x "$INSTALL_DIR/setup/bootstrap-redis.sh"
fi
run_quiet chmod +x "$INSTALL_DIR/setup/setup-ehecoatl.sh"
run_quiet chmod +x "$INSTALL_DIR/setup/uninstall-ehecoatl.sh"
if [ -f "$INSTALL_DIR/setup/uninstall-redis.sh" ]; then
  run_quiet chmod +x "$INSTALL_DIR/setup/uninstall-redis.sh"
fi
run_quiet chmod +x "$INSTALL_DIR/setup/purge-ehecoatl-data.sh"

step "Finishing"
log "System bootstrap completed."
log "Run $INSTALL_DIR/setup/setup-ehecoatl.sh to configure the application."
log "Run $INSTALL_DIR/setup/bootstrap-redis.sh only when you want a local Redis installation managed by Ehecoatl."
