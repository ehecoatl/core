#!/bin/bash
set -euo pipefail

# Bootstrap flow:
# 1. Define installation target and repository source.
# 2. Configure logging, failure, and quiet command helpers.
# 3. Resolve whether sudo is needed.
# 4. Detect whether the bootstrap launcher is already running from a local checkout.
# 5. Ensure git is available when a repository clone is still required.
# 6. Install Node.js 24 with npm when it is not already available.
# 7. Ensure systemd tooling is available for runtime service management.
# 8. Validate the installation target directory when a clone is required.
# 9. Create the installation directory and assign local ownership.
# 10. Initialize a git repository in the target directory.
# 11. Add the remote origin for the Ehecatl repository.
# 12. Fetch tags and remote references from origin.
# 13. Checkout the latest release tag when available.
# 14. Fallback to the default branch when no tag exists.
# 15. Mark setup scripts as executable.
# 16. Log successful bootstrap completion.

INSTALL_DIR="/opt/ehecatl"
REPO_URL="${EHECATL_REPO_URL:-https://github.com/braxismedia/ehecatl.git}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$INSTALL_DIR"
USE_LOCAL_CHECKOUT=0
FORCE_SETUP=0
INSTALLER_PACKAGE_MANAGER=""
INSTALLER_MANAGED_PACKAGES=()

CURRENT_STEP=""

# Stage 2: helper functions for bootstrap logging, failure handling, and quiet command execution.
log() {
  printf '[EHECATL BOOTSTRAP SYSTEM] %s\n' "$1"
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

run_shell_quiet() {
  local output
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
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to run the bootstrap script."
  SUDO="sudo"
fi

# Stage 4: ensure required commands exist before repository operations begin.
require_command() {
  command -v "$1" >/dev/null 2>&1
}

package_is_installed() {
  local package_name="$1"

  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q "install ok installed"
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
  [ -d "$candidate_dir/app" ] && [ -f "$candidate_dir/setup/setup-ehecatl.sh" ]
}

has_install_dir_project_layout() {
  [ -d "$INSTALL_DIR/app" ] && [ -f "$INSTALL_DIR/setup/setup-ehecatl.sh" ]
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
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      ca-certificates curl gnupg apt-transport-https
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

step "Detecting installation source"
parse_args "$@"
if has_local_project_layout "$CHECKOUT_ROOT"; then
  USE_LOCAL_CHECKOUT=1
  PROJECT_DIR="$CHECKOUT_ROOT"
  log "Using existing local checkout at $PROJECT_DIR"
elif has_install_dir_project_layout; then
  if [ "$FORCE_SETUP" -eq 0 ]; then
    log "Detected an existing installation checkout at $INSTALL_DIR."
    log "Bootstrap script will stop without changes. Run ./setup/bootstrap-system.sh --force to reapply setup."
    exit 0
  fi
  USE_LOCAL_CHECKOUT=1
  PROJECT_DIR="$INSTALL_DIR"
  log "Using existing installation checkout at $PROJECT_DIR because --force was provided"
else
  log "No local checkout detected beside setup/bootstrap-system.sh; clone flow will use $INSTALL_DIR"
fi

if [ "$USE_LOCAL_CHECKOUT" -eq 0 ]; then
  step "Checking git"
  install_git
fi

step "Installing Node.js 24"
install_nodejs_24

step "Checking systemd availability"
ensure_systemd

if [ "$USE_LOCAL_CHECKOUT" -eq 0 ]; then
  # Stage 8-13: validate /opt/ehecatl, prepare it as the installation target, and checkout the requested project source.
  step "Preparing installation directory"
  if [ -e "$INSTALL_DIR/.git" ]; then
    fail "Target already contains a git repository at $INSTALL_DIR"
  fi
  if [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    fail "Target directory $INSTALL_DIR already exists and is not empty"
  fi

  run_quiet $SUDO mkdir -p "$INSTALL_DIR"
  run_quiet $SUDO chown "$(id -un)":"$(id -gn)" "$INSTALL_DIR"

  step "Initializing repository"
  cd "$INSTALL_DIR"
  run_quiet git init -q
  run_quiet git remote add origin "$REPO_URL"

  step "Downloading latest release"
  run_quiet git fetch --tags --force origin

  LATEST_TAG="$(
    git for-each-ref --sort=-creatordate --format='%(refname:short)' refs/tags | head -n 1
  )"

  if [ -n "$LATEST_TAG" ]; then
    run_quiet git checkout -q "tags/$LATEST_TAG"
  else
    DEFAULT_BRANCH="$(
      git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p' | head -n 1
    )"
    DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
    run_quiet git fetch --depth 1 origin "$DEFAULT_BRANCH"
    run_quiet git checkout -q -b "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"
  fi
fi

# Stage 15: mark setup scripts as executable.
step "Preparing project setup scripts"
run_quiet chmod +x "$PROJECT_DIR/setup/bootstrap-system.sh"
if [ -f "$PROJECT_DIR/setup/bootstrap-redis.sh" ]; then
  run_quiet chmod +x "$PROJECT_DIR/setup/bootstrap-redis.sh"
fi
run_quiet chmod +x "$PROJECT_DIR/setup/setup-ehecatl.sh"
run_quiet chmod +x "$PROJECT_DIR/setup/uninstall-ehecatl.sh"
run_quiet chmod +x "$PROJECT_DIR/setup/purge-ehecatl-data.sh"

# Stage 16: finalize bootstrap output.
step "Finishing"
log "System bootstrap completed."
log "Run ./setup/setup-ehecatl.sh to install Ehecatl from this checkout."
