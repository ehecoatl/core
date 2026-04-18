#!/bin/bash
set -euo pipefail

# Purge flow:
# 1. Resolve helper paths and load runtime-policy-controlled data directories.
# 2. Configure logging, failure, and quiet command helpers.
# 3. Resolve whether privileged operations will use sudo.
# 4. Show the exact custom data directories that will be removed.
# 5. Require explicit PURGE confirmation from the operator.
# 6. Delete the preserved var, srv, and etc data trees.
# 7. Log successful custom-data removal.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/runtime-policy.sh"

POLICY_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POLICY_FILE="$POLICY_PROJECT_DIR/app/config/runtime-policy.json"

VAR_BASE_DIR="$(policy_value 'paths.varBase')"
SRV_BASE_DIR="$(policy_value 'paths.srvBase')"
ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
INSTALLER_PACKAGE_MANAGER="${INSTALLER_PACKAGE_MANAGER:-}"
INSTALLER_MANAGED_PACKAGES="${INSTALLER_MANAGED_PACKAGES:-}"
REDIS_PACKAGE_NAME="${REDIS_PACKAGE_NAME:-}"
REDIS_SERVICE_NAME="${REDIS_SERVICE_NAME:-}"
REDIS_MANAGED_BY_INSTALLER="${REDIS_MANAGED_BY_INSTALLER:-0}"

CURRENT_STEP=""

# Stage 2: helper functions for purge logging, failures, and quiet command execution.
log() {
  printf '[PURGE] %s\n' "$1"
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

remove_managed_redis_package() {
  [ -z "$INSTALLER_MANAGED_PACKAGES" ] || return 0
  [ "$REDIS_MANAGED_BY_INSTALLER" = "1" ] || return 0
  [ -n "$REDIS_PACKAGE_NAME" ] || return 0

  if command -v apt-get >/dev/null 2>&1; then
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq "$REDIS_PACKAGE_NAME"
    run_quiet $SUDO apt-get autoremove -y -qq
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    run_quiet $SUDO dnf remove -y "$REDIS_PACKAGE_NAME"
  fi
}

remove_installer_managed_packages() {
  [ -n "$INSTALLER_MANAGED_PACKAGES" ] || return 0

  local packages_csv="$INSTALLER_MANAGED_PACKAGES"
  local previous_ifs="$IFS"
  local packages=()
  local package_name

  IFS=','
  # shellcheck disable=SC2206
  packages=($packages_csv)
  IFS="$previous_ifs"

  [ "${#packages[@]}" -gt 0 ] || return 0

  case "$INSTALLER_PACKAGE_MANAGER" in
    apt)
      run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq "${packages[@]}"
      run_quiet $SUDO apt-get autoremove -y -qq
      ;;
    dnf)
      run_quiet $SUDO dnf remove -y "${packages[@]}"
      ;;
    *)
      for package_name in "${packages[@]}"; do
        [ -n "$package_name" ] || continue
        if command -v apt-get >/dev/null 2>&1; then
          run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq "$package_name"
        elif command -v dnf >/dev/null 2>&1; then
          run_quiet $SUDO dnf remove -y "$package_name"
        fi
      done
      if command -v apt-get >/dev/null 2>&1; then
        run_quiet $SUDO apt-get autoremove -y -qq
      fi
      ;;
  esac
}

verify_purge_state() {
  [ ! -e "$ETC_BASE_DIR" ] || fail "Custom etc directory still exists at $ETC_BASE_DIR"
  [ ! -e "$VAR_BASE_DIR" ] || fail "Custom var directory still exists at $VAR_BASE_DIR"
  [ ! -e "$SRV_BASE_DIR" ] || fail "Custom srv directory still exists at $SRV_BASE_DIR"

  if command -v pm2 >/dev/null 2>&1; then
    if $SUDO pm2 describe Ehecoatl >/dev/null 2>&1; then
      fail "PM2 app entry 'Ehecoatl' still exists after purge."
    fi
  fi

  $SUDO test ! -e "$SYSTEMD_UNIT_PATH" || fail "Systemd unit still exists at $SYSTEMD_UNIT_PATH"
  if command -v systemctl >/dev/null 2>&1; then
    if $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1; then
      fail "Systemd unit '$SYSTEMD_UNIT_NAME' is still enabled after purge."
    fi
    if $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1; then
      fail "Systemd unit '$SYSTEMD_UNIT_NAME' is still active after purge."
    fi
  fi

  if [ -n "$INSTALLER_MANAGED_PACKAGES" ]; then
    local packages_csv="$INSTALLER_MANAGED_PACKAGES"
    local previous_ifs="$IFS"
    local packages=()
    local package_name

    IFS=','
    # shellcheck disable=SC2206
    packages=($packages_csv)
    IFS="$previous_ifs"

    for package_name in "${packages[@]}"; do
      [ -n "$package_name" ] || continue

      if command -v dpkg-query >/dev/null 2>&1; then
        if dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q "install ok installed"; then
          fail "Installer-managed package '$package_name' is still installed after purge."
        fi
      fi

      if command -v rpm >/dev/null 2>&1; then
        if rpm -q "$package_name" >/dev/null 2>&1; then
          fail "Installer-managed package '$package_name' is still installed after purge."
        fi
      fi
    done
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
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to purge Ehecoatl data."
  SUDO="sudo"
fi

if $SUDO test -f "$INSTALL_META_FILE"; then
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  # shellcheck disable=SC1090,SC2086
  eval "$metadata_content"
fi

# Stage 4-5: present the destructive scope and require explicit PURGE confirmation.
log "This will permanently remove:"
log "  - $ETC_BASE_DIR"
log "  - $VAR_BASE_DIR"
log "  - $SRV_BASE_DIR"
printf 'Type PURGE to continue: '
read -r confirmation

if [ "$confirmation" != "PURGE" ]; then
  fail "Purge cancelled."
fi

# Stage 6-7: remove custom data trees and report completion.
step "Removing custom data"
run_quiet $SUDO rm -rf "$ETC_BASE_DIR" "$VAR_BASE_DIR" "$SRV_BASE_DIR"
clear_pm2_app_entry
clear_systemd_service_entry
clear_redis_service_entry
remove_managed_redis_package
remove_installer_managed_packages

step "Verifying purge state"
verify_purge_state

step "Finishing"
log "Ehecoatl custom data removed."
