#!/bin/bash
set -euo pipefail

# Purge flow:
# 1. Remove custom Ehecoatl runtime data and stop managed runtime entries.
# 2. Remove contract-defined root helper symlinks.
# 3. Verify that the purge completed successfully.
# 4. Log successful purge completion.

	
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ETC_BASE_DIR="/etc/opt/ehecoatl"
VAR_BASE_DIR="/var/opt/ehecoatl"
SRV_BASE_DIR="/srv/opt/ehecoatl"
LIB_BASE_DIR="/var/lib/ehecoatl"
LOG_BASE_DIR="/var/log/ehecoatl"
NGINX_MANAGED_DIR="/etc/nginx/conf.d/ehecoatl"
NGINX_MANAGED_INCLUDE_FILE="/etc/nginx/conf.d/ehecoatl.conf"
WELCOME_PAGE_SOURCE="/opt/ehecoatl/welcome-ehecoatl.htm"
WELCOME_PAGE_TARGET="/var/www/html/index.nginx-debian.html"
SETUP_SYMLINKS_DERIVER="/opt/ehecoatl/contracts/derive-setup-symlinks.js"
SOURCE_SYMLINKS_DERIVER="$SOURCE_PROJECT_DIR/ehecoatl-runtime/contracts/derive-setup-symlinks.js"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
SECURE_CONFIRMATION_TOKEN="E-H-E-C-O-A-T-L"
CURRENT_STEP=""
SCRIPT_ARGS=("$@")
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log(){ printf '%s[EHECOATL PURGE DATA]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail(){ printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet(){ local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
print_help() {
  cat <<'EOF'
Usage: setup/purge-ehecoatl-data.sh [options]

Purges managed Ehecoatl data roots and contract-created helper symlinks without
reinstalling the runtime payload.

Options:
  --yes               Accept confirmation prompts automatically.
  --non-interactive   Disable interactive prompts.
  --dry-run           Print planned actions without executing them.
  -h, --help          Show this help message.
EOF
}
clear_pm2_app_entry(){ command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecoatl"; return 0; }; $SUDO pm2 delete Ehecoatl >/dev/null 2>&1 || true; }
clear_systemd_service_entry(){ command -v systemctl >/dev/null 2>&1 || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/remove systemd unit $SYSTEMD_UNIT_NAME"; return 0; fi; $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; $SUDO rm -f "$SYSTEMD_UNIT_PATH"; $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; }
require_secure_confirmation(){ local confirmation=""; log "This action is destructive and requires secure confirmation."; log "Type the following token exactly to continue: $SECURE_CONFIRMATION_TOKEN"; [ "$NON_INTERACTIVE" -eq 0 ] || fail "Secure confirmation requires an interactive terminal. Re-run without --non-interactive."; printf 'Secure confirmation: '; read -r -s confirmation; printf '\n'; [ "$confirmation" = "$SECURE_CONFIRMATION_TOKEN" ] || fail "Secure confirmation did not match. Purge cancelled."; }
resolve_symlinks_deriver() {
  if [ -f "$SETUP_SYMLINKS_DERIVER" ]; then
    printf '%s\n' "$SETUP_SYMLINKS_DERIVER"
    return 0
  fi
  if [ -f "$SOURCE_SYMLINKS_DERIVER" ]; then
    printf '%s\n' "$SOURCE_SYMLINKS_DERIVER"
    return 0
  fi
  return 1
}
remove_root_workspace_if_empty() {
  local workspace_dir="$1"
  [ -n "${workspace_dir:-}" ] || return 0
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] remove $workspace_dir if empty"
    return 0
  fi
  $SUDO test -d "$workspace_dir" || return 0
  if [ -z "$($SUDO find "$workspace_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    if $SUDO test -d "$workspace_dir"; then
      run_quiet $SUDO rmdir "$workspace_dir"
    fi
  fi
}
remove_contract_symlinks() {
  local symlinks_deriver link_path target_path workspace_dir
  declare -A workspace_dirs=()
  symlinks_deriver="$(resolve_symlinks_deriver)" || fail "Setup symlinks deriver not found in installed runtime or source checkout."

  while IFS=$'\t' read -r link_path target_path; do
    [ -n "${link_path:-}" ] || continue
    workspace_dir="$(dirname "$link_path")"
    workspace_dirs["$workspace_dir"]=1

    if $SUDO test -L "$link_path"; then
      run_quiet $SUDO rm -f "$link_path"
      continue
    fi

    if $SUDO test -e "$link_path"; then
      log "Preserving non-symlink path at $link_path"
    fi
  done < <(node "$symlinks_deriver" tsv)

  for workspace_dir in "${!workspace_dirs[@]}"; do
    remove_root_workspace_if_empty "$workspace_dir"
  done
}
remove_welcome_page_target_if_managed() {
  if ! $SUDO test -L "$WELCOME_PAGE_TARGET"; then
    return 0
  fi

  local link_target
  link_target="$($SUDO readlink "$WELCOME_PAGE_TARGET" 2>/dev/null || true)"
  [ "$link_target" = "$WELCOME_PAGE_SOURCE" ] || return 0
  run_quiet $SUDO rm -f "$WELCOME_PAGE_TARGET"
}
verify_contract_symlinks_absent() {
  local symlinks_deriver link_path target_path
  symlinks_deriver="$(resolve_symlinks_deriver)" || fail "Setup symlinks deriver not found in installed runtime or source checkout."

  while IFS=$'\t' read -r link_path target_path; do
    [ -n "${link_path:-}" ] || continue
    if $SUDO test -L "$link_path"; then
      fail "Contract symlink still exists at purge end: $link_path"
    fi
  done < <(node "$symlinks_deriver" tsv)
}
verify_purge_state(){ [ "$DRY_RUN" -eq 1 ] && return 0; $SUDO test ! -e "$ETC_BASE_DIR" || fail "Etc base still exists at $ETC_BASE_DIR"; $SUDO test ! -e "$VAR_BASE_DIR" || fail "Var base still exists at $VAR_BASE_DIR"; $SUDO test ! -e "$SRV_BASE_DIR" || fail "Srv base still exists at $SRV_BASE_DIR"; $SUDO test ! -e "$LIB_BASE_DIR" || fail "Lib base still exists at $LIB_BASE_DIR"; $SUDO test ! -e "$LOG_BASE_DIR" || fail "Log base still exists at $LOG_BASE_DIR"; $SUDO test ! -e "$NGINX_MANAGED_DIR" || fail "Managed Nginx dir still exists at $NGINX_MANAGED_DIR"; $SUDO test ! -e "$NGINX_MANAGED_INCLUDE_FILE" || fail "Managed Nginx include file still exists at $NGINX_MANAGED_INCLUDE_FILE"; verify_contract_symlinks_absent; }
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in -h|--help) print_help; exit 0 ;; --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
require_root(){
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "purge-ehecoatl-data.sh could not acquire root privileges through sudo."
    exec sudo EHECOATL_SETUP_SUDO_REEXEC=1 bash "$0" "${SCRIPT_ARGS[@]}"
  fi
  fail "purge-ehecoatl-data.sh must be run as root. sudo is not available on this host."
}
SUDO=""
parse_args "$@"
require_root
if $SUDO test -f "$INSTALL_META_FILE"; then metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"; fi
if [ "$DRY_RUN" -eq 1 ]; then log "Dry run summary:"; log "What will be removed:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"; log "  - $LIB_BASE_DIR"; log "  - $LOG_BASE_DIR"; log "  - $NGINX_MANAGED_DIR"; log "  - $NGINX_MANAGED_INCLUDE_FILE"; log "  - Contract-defined symlinks under /root/ehecoatl"; log "What will be changed:"; log "  - Stop/disable Ehecoatl service and clear PM2 entry"; log "What will be preserved:"; log "  - Redis"; log "  - External or pre-existing Nginx package/service"; exit 0; fi
log "This will permanently remove:"; log "  - $ETC_BASE_DIR"; log "  - $VAR_BASE_DIR"; log "  - $SRV_BASE_DIR"; log "  - $LIB_BASE_DIR"; log "  - $LOG_BASE_DIR"; log "  - $NGINX_MANAGED_DIR"; log "  - $NGINX_MANAGED_INCLUDE_FILE"
require_secure_confirmation
# Step 1: Remove custom data and stop runtime entries.
step 1 "Removing custom data"
run_quiet $SUDO rm -rf "$ETC_BASE_DIR" "$VAR_BASE_DIR" "$SRV_BASE_DIR" "$LIB_BASE_DIR" "$LOG_BASE_DIR" "$NGINX_MANAGED_DIR"
run_quiet $SUDO rm -f "$NGINX_MANAGED_INCLUDE_FILE"
remove_welcome_page_target_if_managed
clear_pm2_app_entry
clear_systemd_service_entry

# Step 2: Remove contract-defined root helper symlinks.
step 2 "Removing root helper symlinks"
remove_contract_symlinks

# Step 3: Verify the purge state.
step 3 "Verifying purge state"
verify_purge_state

# Step 4: Finish the purge flow.
step 4 "Finishing"
log "Ehecoatl custom data removed."
log "Redis was intentionally left untouched. Use setup/uninstall/uninstall-redis.sh only if a local Redis installation was previously managed by Ehecoatl."
