#!/bin/bash
set -euo pipefail

ETC_BASE_DIR="/etc/opt/ehecoatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
REDIS_PACKAGE_NAME=""
REDIS_SERVICE_NAME=""
REDIS_MANAGED_BY_INSTALLER=0
REDIS_SUPPORTED_MAJOR=""
CURRENT_STEP=""
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0

log(){ printf '[UNINSTALL REDIS] %s\n' "$1"; }
fail(){ printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet(){ local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
step(){ CURRENT_STEP="$1"; log "$CURRENT_STEP"; }
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || fail "sudo is required to uninstall Redis."; SUDO="sudo"; fi
require_command(){ command -v "$1" >/dev/null 2>&1; }
redis_server_command(){ if require_command redis-server; then printf '%s\n' redis-server; return 0; fi; [ -x /usr/sbin/redis-server ] && printf '%s\n' /usr/sbin/redis-server || return 1; }
redis_major_version(){ local redis_cmd version_string; redis_cmd="$(redis_server_command)" || return 1; version_string="$($redis_cmd --version 2>/dev/null | sed -n 's/.*v=\([0-9][0-9]*\)\..*/\1/p' | head -n 1)"; [ -n "$version_string" ] || return 1; printf '%s\n' "$version_string"; }
remove_redis_package(){ [ "$REDIS_MANAGED_BY_INSTALLER" = "1" ] || fail "Redis is not marked as installer-managed. Nothing will be removed."; [ -n "$REDIS_PACKAGE_NAME" ] || fail "Redis package metadata is missing."; if require_command apt-get; then run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq "$REDIS_PACKAGE_NAME"; run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq; return 0; fi; if require_command dnf; then run_quiet $SUDO dnf remove -y "$REDIS_PACKAGE_NAME"; return 0; fi; fail "Could not remove Redis automatically on this host."; }
clear_redis_service_entry(){ command -v systemctl >/dev/null 2>&1 || return 0; [ "$REDIS_MANAGED_BY_INSTALLER" = "1" ] || fail "Redis is not marked as installer-managed."; [ -n "$REDIS_SERVICE_NAME" ] || fail "Redis service metadata is missing."; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] disable/stop Redis service $REDIS_SERVICE_NAME"; return 0; }; $SUDO systemctl disable --now "$REDIS_SERVICE_NAME" >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$REDIS_SERVICE_NAME" >/dev/null 2>&1 || true; }
write_install_metadata_without_redis(){ [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] clear Redis metadata in $INSTALL_META_FILE"; return 0; }; local metadata; metadata=$($SUDO awk '/^REDIS_PACKAGE_NAME=/ { print "REDIS_PACKAGE_NAME=\"\""; next } /^REDIS_SERVICE_NAME=/ { print "REDIS_SERVICE_NAME=\"\""; next } /^REDIS_MANAGED_BY_INSTALLER=/ { print "REDIS_MANAGED_BY_INSTALLER=\"0\""; next } /^REDIS_SUPPORTED_MAJOR=/ { print "REDIS_SUPPORTED_MAJOR=\"\""; next } { print }' "$INSTALL_META_FILE"); if ! printf '%s\n' "$metadata" | $SUDO tee "$INSTALL_META_FILE" >/dev/null; then fail "Could not update install metadata at $INSTALL_META_FILE"; fi; }
verify_uninstall_state(){ [ "$DRY_RUN" -eq 1 ] && return 0; }
parse_args "$@"
if ! $SUDO test -f "$INSTALL_META_FILE"; then fail "Install metadata was not found at $INSTALL_META_FILE"; fi
metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"
if [ "$DRY_RUN" -eq 1 ]; then log "Dry run summary:"; log "What will be removed:"; log "  - Installer-managed Redis package: ${REDIS_PACKAGE_NAME:-unknown}"; log "What will be changed:"; log "  - Stop/disable Redis service: ${REDIS_SERVICE_NAME:-unknown}"; log "  - Clear Redis ownership metadata in $INSTALL_META_FILE"; exit 0; fi
step "Validating Redis ownership"; [ "$REDIS_MANAGED_BY_INSTALLER" = "1" ] || fail "Redis is not marked as installer-managed in $INSTALL_META_FILE"; [ -z "$REDIS_SUPPORTED_MAJOR" ] || log "Expected Redis major during managed install: $REDIS_SUPPORTED_MAJOR"; if current_major="$(redis_major_version || true)"; then log "Detected Redis major before uninstall: $current_major"; fi
step "Stopping Redis service"; clear_redis_service_entry
step "Removing Redis package"; remove_redis_package
step "Clearing Redis installation metadata"; write_install_metadata_without_redis
step "Verifying uninstall state"; verify_uninstall_state
step "Finishing"; log "Installer-managed Redis removed."; log "If Redis was not installed by Ehecoatl, this script must not be used."
