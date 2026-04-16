#!/bin/bash
set -euo pipefail

# Purge flow:
# 1. Remove custom Ehecatl runtime data and stop managed runtime entries.
# 2. Verify that the purge completed successfully.
# 3. Log successful purge completion.


ETC_BASE_DIR="/etc/opt/ehecatl"
VAR_BASE_DIR="/var/opt/ehecatl"
SRV_BASE_DIR="/srv/opt/ehecatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
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

log(){ printf '%s[EHECATL PURGE DATA]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail(){ printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet(){ local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
clear_pm2_app_entry(){ command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecatl"; return 0; }; $SUDO pm2 delete Ehecatl >/dev/null 2>&1 || true; }
clear_systemd_service_entry(){ command -v systemctl >/dev/null 2>&1 || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/remove systemd unit $SYSTEMD_UNIT_NAME"; return 0; fi; $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; $SUDO rm -f "$SYSTEMD_UNIT_PATH"; $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; }
verify_purge_state(){ [ "$DRY_RUN" -eq 1 ] && return 0; $SUDO test ! -e "$ETC_BASE_DIR" || fail "Etc base still exists at $ETC_BASE_DIR"; $SUDO test ! -e "$VAR_BASE_DIR" || fail "Var base still exists at $VAR_BASE_DIR"; $SUDO test ! -e "$SRV_BASE_DIR" || fail "Srv base still exists at $SRV_BASE_DIR"; }
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to purge Ehecatl data."; SUDO="sudo"; fi
parse_args "$@"
if $SUDO test -f "$INSTALL_META_FILE"; then metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"; fi
if [ "$DRY_RUN" -eq 1 ]; then log "Dry run summary:"; log "What will be removed:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"; log "What will be changed:"; log "  - Stop/disable Ehecatl service and clear PM2 entry"; log "What will be preserved:"; log "  - Redis"; exit 0; fi
log "This will permanently remove:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"
if [ "$YES_MODE" -eq 1 ]; then confirmation="PURGE"; elif [ "$NON_INTERACTIVE" -eq 1 ]; then fail "Purge requires explicit confirmation. Re-run with --yes --non-interactive or run interactively."; else printf 'Type PURGE to continue: '; read -r confirmation; fi
[ "$confirmation" = "PURGE" ] || fail "Purge cancelled."
# Step 1: Remove custom data and stop runtime entries.
step 1 "Removing custom data"
run_quiet $SUDO rm -rf "$ETC_BASE_DIR" "$VAR_BASE_DIR" "$SRV_BASE_DIR"
clear_pm2_app_entry
clear_systemd_service_entry

# Step 2: Verify the purge state.
step 2 "Verifying purge state"
verify_purge_state

# Step 3: Finish the purge flow.
step 3 "Finishing"
log "Ehecatl custom data removed."
log "Redis was intentionally left untouched. Use setup/uninstall-redis.sh only if a local Redis installation was previously managed by Ehecatl."