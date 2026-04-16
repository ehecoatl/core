#!/bin/bash
set -euo pipefail

# Uninstall flow:
# 1. Remove the published Ehecatl CLI command.
# 2. Remove the project files and stop managed runtime entries.
# 3. Remove installation metadata.
# 4. Verify the uninstall state.
# 5. Log successful uninstall completion.


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
CURRENT_STEP=""
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

log() { printf '%s[EHECATL UNINSTALL]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail() { printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet() { local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
clear_pm2_app_entry() { command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecatl"; return 0; }; $SUDO pm2 delete Ehecatl >/dev/null 2>&1 || true; }
clear_systemd_service_entry() { command -v systemctl >/dev/null 2>&1 || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/remove systemd unit $SYSTEMD_UNIT_NAME"; return 0; fi; $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; $SUDO rm -f "$SYSTEMD_UNIT_PATH"; $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; }
verify_uninstall_state() { [ "$DRY_RUN" -eq 1 ] && return 0; [ ! -e "$CLI_TARGET" ] || fail "CLI target still exists at $CLI_TARGET"; if [ -n "${PROJECT_DIR:-}" ]; then [ ! -e "$PROJECT_DIR" ] || fail "Project directory still exists at $PROJECT_DIR"; fi; $SUDO test ! -e "$INSTALL_META_FILE" || fail "Install metadata still exists at $INSTALL_META_FILE"; }
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to uninstall Ehecatl."; SUDO="sudo"; fi
PROJECT_DIR="$DEFAULT_PROJECT_DIR"
parse_args "$@"
if $SUDO test -f "$INSTALL_META_FILE"; then metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"; fi
POLICY_PROJECT_DIR="${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"; POLICY_FILE="$POLICY_PROJECT_DIR/app/config/runtime-policy.json"
if [ -f "$POLICY_FILE" ]; then CLI_TARGET="/usr/local/bin/ehecatl"; VAR_BASE_DIR="$(policy_value 'paths.varBase')"; SRV_BASE_DIR="$(policy_value 'paths.srvBase')"; ETC_BASE_DIR="$(policy_value 'paths.etcBase')"; INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"; fi
if [ "$DRY_RUN" -eq 1 ]; then log "Dry run summary:"; log "What will be removed:"; log "  - CLI symlink at $CLI_TARGET"; log "  - Project directory at ${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"; log "  - Install metadata at $INSTALL_META_FILE"; log "What will be changed:"; log "  - Stop/disable Ehecatl service and clear PM2 entry"; log "What will be preserved:"; log "  - Custom data in $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR"; log "  - Redis"; exit 0; fi
# Step 1: Remove the published CLI command.
step 1 "Removing CLI command"
if [ -L "$CLI_TARGET" ] || [ -f "$CLI_TARGET" ]; then run_quiet $SUDO rm -f "$CLI_TARGET"; fi

# Step 2: Remove the project files and stop runtime entries.
step 2 "Removing project files"
clear_pm2_app_entry
clear_systemd_service_entry
if [ -n "${PROJECT_DIR:-}" ] && [ -d "$PROJECT_DIR" ]; then run_quiet $SUDO rm -rf "$PROJECT_DIR"; else log "Project directory not found, skipping."; fi

# Step 3: Remove installation metadata.
step 3 "Removing installation metadata"
run_quiet $SUDO rm -f "$INSTALL_META_FILE"

# Step 4: Verify the uninstall state.
step 4 "Verifying uninstall state"
verify_uninstall_state

# Step 5: Finish the uninstall flow.
step 5 "Finishing"
log "Ehecatl binaries/project removed."
log "Custom data in $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR was preserved."
log "Redis was intentionally left untouched. Run setup/uninstall-redis.sh only if Ehecatl previously managed a local Redis installation."