#!/bin/bash
set -euo pipefail

# Uninstall flow:
# 1. Resolve helper paths and initialize uninstall defaults.
# 2. Configure logging, failure, and quiet command helpers.
# 3. Resolve whether privileged operations will use sudo.
# 4. Read installation metadata to recover the installed project location.
# 5. Load runtime-policy paths when the policy file is still available.
# 6. Remove the published Ehecatl CLI symlink.
# 7. Remove the installed project files from disk.
# 8. Remove installation metadata from the etc base.
# 9. Keep custom data untouched and log the remaining purge option.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/runtime-policy.sh"
DEFAULT_PROJECT_DIR="/opt/ehecatl"
CLI_TARGET="/usr/local/bin/ehecatl"
ETC_BASE_DIR="/etc/opt/ehecatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
VAR_BASE_DIR="/var/opt/ehecatl"
SRV_BASE_DIR="/srv/opt/ehecatl"
SYSTEMD_UNIT_NAME="ehecatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
REDIS_PACKAGE_NAME="${REDIS_PACKAGE_NAME:-}"
REDIS_SERVICE_NAME="${REDIS_SERVICE_NAME:-}"

CURRENT_STEP=""

# Stage 2: helper functions for uninstall logging, failures, and quiet command execution.
log() {
  printf '[UNINSTALL] %s\n' "$1"
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
  $SUDO pm2 delete Ehecatl >/dev/null 2>&1 || true
}

clear_systemd_service_entry() {
  command -v systemctl >/dev/null 2>&1 || return 0
  $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$SYSTEMD_UNIT_PATH"
  $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
  $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
}

clear_redis_service_entry() {
  command -v systemctl >/dev/null 2>&1 || return 0

  if [ -n "$REDIS_SERVICE_NAME" ]; then
    $SUDO systemctl disable --now "$REDIS_SERVICE_NAME" >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed "$REDIS_SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if systemctl list-unit-files redis-server.service >/dev/null 2>&1; then
    $SUDO systemctl disable --now redis-server >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed redis-server >/dev/null 2>&1 || true
  fi

  if systemctl list-unit-files redis.service >/dev/null 2>&1; then
    $SUDO systemctl disable --now redis >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed redis >/dev/null 2>&1 || true
  fi
}

verify_uninstall_state() {
  [ ! -e "$CLI_TARGET" ] || fail "CLI target still exists at $CLI_TARGET"
  if [ -n "${PROJECT_DIR:-}" ]; then
    [ ! -e "$PROJECT_DIR" ] || fail "Project directory still exists at $PROJECT_DIR"
  fi
  $SUDO test ! -e "$INSTALL_META_FILE" || fail "Install metadata still exists at $INSTALL_META_FILE"

  if command -v pm2 >/dev/null 2>&1; then
    if $SUDO pm2 describe Ehecatl >/dev/null 2>&1; then
      fail "PM2 app entry 'Ehecatl' still exists after uninstall."
    fi
  fi

  $SUDO test ! -e "$SYSTEMD_UNIT_PATH" || fail "Systemd unit still exists at $SYSTEMD_UNIT_PATH"
  if command -v systemctl >/dev/null 2>&1; then
    if $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1; then
      fail "Systemd unit '$SYSTEMD_UNIT_NAME' is still enabled after uninstall."
    fi
    if $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1; then
      fail "Systemd unit '$SYSTEMD_UNIT_NAME' is still active after uninstall."
    fi
  fi
}

step() {
  CURRENT_STEP="$1"
  log "$CURRENT_STEP"
}

trap 'fail "Command failed on line $LINENO."' ERR

# Stage 3: resolve whether privileged operations will use sudo.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to uninstall Ehecatl."
  SUDO="sudo"
fi

PROJECT_DIR="$DEFAULT_PROJECT_DIR"

# Stage 4: recover the installed project location from installation metadata when available.
if $SUDO test -f "$INSTALL_META_FILE"; then
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  # shellcheck disable=SC1090,SC2086
  eval "$metadata_content"
fi

# Stage 5: load policy-driven data paths when the installed policy file is still available.
POLICY_PROJECT_DIR="${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"
POLICY_FILE="$POLICY_PROJECT_DIR/app/config/runtime-policy.json"
if [ -f "$POLICY_FILE" ]; then
  CLI_TARGET="/usr/local/bin/ehecatl"
  VAR_BASE_DIR="$(policy_value 'paths.varBase')"
  SRV_BASE_DIR="$(policy_value 'paths.srvBase')"
  ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
  INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
fi

# Stage 6: remove the published CLI symlink from the system PATH.
step "Removing CLI command"
if [ -L "$CLI_TARGET" ] || [ -f "$CLI_TARGET" ]; then
  run_quiet $SUDO rm -f "$CLI_TARGET"
fi

# Stage 7: remove the installed project checkout while preserving runtime data.
step "Removing project files"
clear_pm2_app_entry
clear_systemd_service_entry
clear_redis_service_entry
if [ -n "${PROJECT_DIR:-}" ] && [ -d "$PROJECT_DIR" ]; then
  run_quiet $SUDO rm -rf "$PROJECT_DIR"
else
  log "Project directory not found, skipping."
fi

# Stage 8: remove install metadata after the project files are gone.
step "Removing installation metadata"
run_quiet $SUDO rm -f "$INSTALL_META_FILE"

step "Verifying uninstall state"
verify_uninstall_state

# Stage 9: finish uninstall while preserving custom data directories.
step "Finishing"
log "Ehecatl binaries/project removed."
log "Custom data in $ETC_BASE_DIR, $VAR_BASE_DIR and $SRV_BASE_DIR was preserved."
log "To remove custom data too, run purge-ehecatl-data.sh from another Ehecatl checkout before or after reinstalling."
