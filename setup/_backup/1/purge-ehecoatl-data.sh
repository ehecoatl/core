#!/bin/bash
set -euo pipefail

ETC_BASE_DIR="/etc/opt/ehecoatl"
VAR_BASE_DIR="/var/opt/ehecoatl"
SRV_BASE_DIR="/srv/opt/ehecoatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
CURRENT_STEP=""
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0

log(){ printf '[PURGE] %s\n' "$1"; }
fail(){ printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet(){ local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
clear_pm2_app_entry(){ command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecoatl"; return 0; }; $SUDO pm2 delete Ehecoatl >/dev/null 2>&1 || true; }
clear_systemd_service_entry(){ command -v systemctl >/dev/null 2>&1 || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/remove systemd unit $SYSTEMD_UNIT_NAME"; return 0; fi; $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; $SUDO rm -f "$SYSTEMD_UNIT_PATH"; $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; }
verify_purge_state(){ [ "$DRY_RUN" -eq 1 ] && return 0; $SUDO test ! -e "$ETC_BASE_DIR" || fail "Etc base still exists at $ETC_BASE_DIR"; $SUDO test ! -e "$VAR_BASE_DIR" || fail "Var base still exists at $VAR_BASE_DIR"; $SUDO test ! -e "$SRV_BASE_DIR" || fail "Srv base still exists at $SRV_BASE_DIR"; }
step(){ CURRENT_STEP="$1"; log "$CURRENT_STEP"; }
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to purge Ehecoatl data."; SUDO="sudo"; fi
parse_args "$@"
if $SUDO test -f "$INSTALL_META_FILE"; then metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"; fi
if [ "$DRY_RUN" -eq 1 ]; then log "Dry run summary:"; log "What will be removed:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"; log "What will be changed:"; log "  - Stop/disable Ehecoatl service and clear PM2 entry"; log "What will be preserved:"; log "  - Redis"; exit 0; fi
log "This will permanently remove:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"
if [ "$YES_MODE" -eq 1 ]; then confirmation="PURGE"; elif [ "$NON_INTERACTIVE" -eq 1 ]; then fail "Purge requires explicit confirmation. Re-run with --yes --non-interactive or run interactively."; else printf 'Type PURGE to continue: '; read -r confirmation; fi
[ "$confirmation" = "PURGE" ] || fail "Purge cancelled."
step "Removing custom data"; run_quiet $SUDO rm -rf "$ETC_BASE_DIR" "$VAR_BASE_DIR" "$SRV_BASE_DIR"; clear_pm2_app_entry; clear_systemd_service_entry
step "Verifying purge state"; verify_purge_state
step "Finishing"; log "Ehecoatl custom data removed."; log "Redis was intentionally left untouched. Use setup/uninstall-redis.sh only if a local Redis installation was previously managed by Ehecoatl."
