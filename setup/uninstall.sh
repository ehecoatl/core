#!/bin/bash
set -eEuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_RUNTIME_DIR="$SOURCE_PROJECT_DIR/ehecoatl-runtime"
DEFAULT_PROJECT_DIR="/opt/ehecoatl"
INSTALL_DIR="$DEFAULT_PROJECT_DIR"
RUNTIME_POLICY_HELPER="$SOURCE_RUNTIME_DIR/cli/lib/runtime-policy.sh"
SOURCE_SYMLINKS_DERIVER="$SOURCE_RUNTIME_DIR/contracts/derive-setup-symlinks.js"
CLI_TARGET="/usr/local/bin/ehecoatl"
ETC_BASE_DIR="/etc/opt/ehecoatl"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
INSTALL_REGISTRY_FILE="/var/lib/ehecoatl/registry/install.json"
NGINX_PACKAGE_NAME=""
NGINX_SERVICE_NAME=""
NGINX_MANAGED_BY_INSTALLER=0
NGINX_MANAGED_INCLUDE_FILE="/etc/nginx/conf.d/ehecoatl.conf"
WELCOME_PAGE_SOURCE="/opt/ehecoatl/welcome-ehecoatl.htm"
WELCOME_PAGE_TARGET="/var/www/html/index.nginx-debian.html"
SOURCE_PACKAGE_JSON="$SOURCE_RUNTIME_DIR/package.json"
INSTALLED_PACKAGE_JSON="$INSTALL_DIR/package.json"
LETS_ENCRYPT_PACKAGE_NAME=""
LETS_ENCRYPT_MANAGED_BY_INSTALLER=0
SECURE_CONFIRMATION_TOKEN="EHECOATL"
CURRENT_STEP=""
SCRIPT_ARGS=("$@")
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
PURGE_AFTER_UNINSTALL=0
EHECOATL_USER="ehecoatl"
EHECOATL_GROUP="ehecoatl"
EHECOATL_USER_CREATED_BY_INSTALLER=0
EHECOATL_GROUP_CREATED_BY_INSTALLER=0
INSTALL_ID=""
SUPERVISOR_USER=""
SUPERVISOR_GROUP="g_superScope"
SUPERVISOR_USER_CREATED_BY_INSTALLER=0
SUPERVISOR_GROUP_CREATED_BY_INSTALLER=0
DIRECTOR_GROUP="g_directorScope"
DIRECTOR_GROUP_CREATED_BY_INSTALLER=0

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECOATL UNINSTALL]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail() { printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet() { local output; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi; if ! output="$("$@" 2>&1)"; then fail "$output"; fi; }
print_help() {
  cat <<'EOF'
Usage: setup/uninstall.sh [options]

Removes the installed Ehecoatl runtime, systemd service, installer-managed
system users/groups, and installer-managed companion packages recorded in the
installation metadata.

Options:
  --yes               Accept confirmation prompts automatically.
  --non-interactive   Disable interactive prompts.
  --dry-run           Print planned actions without executing them.
  --purge             Run setup/uninstall/purge-data.sh after uninstall.
  -h, --help          Show this help message.
EOF
}
clear_pm2_app_entry() { command -v pm2 >/dev/null 2>&1 || return 0; [ "$DRY_RUN" -eq 1 ] && { log "[dry-run] $SUDO pm2 delete Ehecoatl"; return 0; }; $SUDO pm2 delete Ehecoatl >/dev/null 2>&1 || true; }
clear_systemd_service_entry() { command -v systemctl >/dev/null 2>&1 || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/remove systemd unit $SYSTEMD_UNIT_NAME"; return 0; fi; $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; $SUDO rm -f "$SYSTEMD_UNIT_PATH"; $SUDO systemctl daemon-reload >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true; }
require_command(){ command -v "$1" >/dev/null 2>&1; }
package_is_installed(){ local package_name="$1"; if command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q 'install ok installed'; return $?; fi; if command -v rpm >/dev/null 2>&1; then rpm -q "$package_name" >/dev/null 2>&1; return $?; fi; return 1; }
clear_nginx_service_entry(){ command -v systemctl >/dev/null 2>&1 || return 0; [ "$NGINX_MANAGED_BY_INSTALLER" = "1" ] || return 0; [ -n "$NGINX_SERVICE_NAME" ] || return 0; if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] disable/stop Nginx service $NGINX_SERVICE_NAME"; return 0; fi; $SUDO systemctl disable --now "$NGINX_SERVICE_NAME" >/dev/null 2>&1 || true; $SUDO systemctl reset-failed "$NGINX_SERVICE_NAME" >/dev/null 2>&1 || true; }
remove_nginx_package(){ [ "$NGINX_MANAGED_BY_INSTALLER" = "1" ] || { log "Nginx was not installer-managed; skipping package removal."; return 0; }; [ -n "$NGINX_PACKAGE_NAME" ] || fail "Nginx package metadata is missing."; clear_nginx_service_entry; if ! package_is_installed "$NGINX_PACKAGE_NAME"; then log "Nginx package '$NGINX_PACKAGE_NAME' is already absent; skipping package removal."; return 0; fi; if require_command apt-get; then run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq "$NGINX_PACKAGE_NAME"; run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq; return 0; fi; if require_command dnf; then run_quiet $SUDO dnf remove -y "$NGINX_PACKAGE_NAME"; return 0; fi; fail "Could not remove Nginx automatically on this host."; }
remove_lets_encrypt_package(){ local package_name installed_packages=(); [ "$LETS_ENCRYPT_MANAGED_BY_INSTALLER" = "1" ] || { log "Let's Encrypt client was not installer-managed; skipping package removal."; return 0; }; [ -n "$LETS_ENCRYPT_PACKAGE_NAME" ] || fail "Let's Encrypt package metadata is missing."; for package_name in $LETS_ENCRYPT_PACKAGE_NAME; do if package_is_installed "$package_name"; then installed_packages+=("$package_name"); fi; done; if [ "${#installed_packages[@]}" -eq 0 ]; then log "Let's Encrypt package '$LETS_ENCRYPT_PACKAGE_NAME' is already absent; skipping package removal."; return 0; fi; if require_command apt-get; then run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq "${installed_packages[@]}"; run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq; return 0; fi; if require_command dnf; then run_quiet $SUDO dnf remove -y "${installed_packages[@]}"; return 0; fi; fail "Could not remove Let's Encrypt automatically on this host."; }
require_secure_confirmation(){ local confirmation=""; log "This action is destructive and requires secure confirmation."; log "Type the following token exactly to continue: $SECURE_CONFIRMATION_TOKEN"; [ "$NON_INTERACTIVE" -eq 0 ] || fail "Secure confirmation requires an interactive terminal. Re-run without --non-interactive."; printf 'Secure confirmation: '; read -r confirmation; [ "$confirmation" = "$SECURE_CONFIRMATION_TOKEN" ] || fail "Secure confirmation did not match. Uninstall cancelled."; }
resolve_symlinks_deriver() {
  if [ -f "$SOURCE_SYMLINKS_DERIVER" ]; then
    printf '%s\n' "$SOURCE_SYMLINKS_DERIVER"
    return 0
  fi
  return 1
}
require_source_runtime_project() {
  [ -f "$SOURCE_PACKAGE_JSON" ] || fail "Local project runtime package.json not found at $SOURCE_PACKAGE_JSON"
  [ -f "$RUNTIME_POLICY_HELPER" ] || fail "Local project runtime policy helper not found at $RUNTIME_POLICY_HELPER"
  [ -f "$SOURCE_SYMLINKS_DERIVER" ] || fail "Local setup symlinks deriver not found at $SOURCE_SYMLINKS_DERIVER"
}
infer_source_release_from_checkout() {
  local checkout_parent
  [ -n "${SOURCE_PROJECT_DIR:-}" ] || return 1
  checkout_parent="$(dirname "$SOURCE_PROJECT_DIR")"
  [ "$(basename "$checkout_parent")" = "ehecoatl" ] || return 1
  printf '%s\n' "$(basename "$SOURCE_PROJECT_DIR")"
}
read_package_identity() {
  local package_path="$1"
  node -e '
    const fs = require(`node:fs`);
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], `utf8`));
    const fallbackVersion = process.argv[2] || ``;
    const version = pkg?.version === `{{version}}` ? fallbackVersion : pkg?.version;
    if (!pkg?.name || !version) process.exit(2);
    process.stdout.write(JSON.stringify({ name: pkg.name, version }));
  ' "$package_path" "${2:-}"
}
verify_local_project_matches_install() {
  require_source_runtime_project
  [ -f "$INSTALLED_PACKAGE_JSON" ] || return 0

  local source_identity installed_identity source_release
  source_release="$(infer_source_release_from_checkout || true)"
  source_identity="$(read_package_identity "$SOURCE_PACKAGE_JSON" "$source_release")" || fail "Could not read project package identity from $SOURCE_PACKAGE_JSON"
  installed_identity="$(read_package_identity "$INSTALLED_PACKAGE_JSON")" || fail "Could not read installed package identity from $INSTALLED_PACKAGE_JSON"

  node -e '
    const sourcePkg = JSON.parse(process.argv[1]);
    const installedPkg = JSON.parse(process.argv[2]);
    const same = sourcePkg.name === installedPkg.name && sourcePkg.version === installedPkg.version;
    if (!same) {
      console.error(`Project package ${sourcePkg.name}@${sourcePkg.version} does not match installed package ${installedPkg.name}@${installedPkg.version}.`);
      process.exit(1);
    }
  ' "$source_identity" "$installed_identity" || fail "Local project version does not match the installed runtime. Refusing uninstall."
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
    $SUDO rmdir "$workspace_dir" >/dev/null 2>&1 || true
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
      fail "Contract symlink still exists at uninstall end: $link_path"
    fi
  done < <(node "$symlinks_deriver" tsv)
}
verify_uninstall_state() { [ "$DRY_RUN" -eq 1 ] && return 0; [ ! -e "$CLI_TARGET" ] || fail "CLI target still exists at $CLI_TARGET"; if [ -n "${PROJECT_DIR:-}" ]; then [ ! -e "$PROJECT_DIR" ] || fail "Project directory still exists at $PROJECT_DIR"; fi; if [ "$EHECOATL_USER_CREATED_BY_INSTALLER" = "1" ] && id "$EHECOATL_USER" >/dev/null 2>&1; then fail "Runtime user still exists at uninstall end: $EHECOATL_USER"; fi; if [ "$SUPERVISOR_USER_CREATED_BY_INSTALLER" = "1" ] && id "$SUPERVISOR_USER" >/dev/null 2>&1; then fail "Supervisor scope user still exists at uninstall end: $SUPERVISOR_USER"; fi; if [ "$EHECOATL_GROUP_CREATED_BY_INSTALLER" = "1" ] && getent group "$EHECOATL_GROUP" >/dev/null 2>&1; then fail "Runtime group still exists at uninstall end: $EHECOATL_GROUP"; fi; if [ "$SUPERVISOR_GROUP_CREATED_BY_INSTALLER" = "1" ] && getent group "$SUPERVISOR_GROUP" >/dev/null 2>&1; then fail "Supervisor scope group still exists at uninstall end: $SUPERVISOR_GROUP"; fi; if [ "$DIRECTOR_GROUP_CREATED_BY_INSTALLER" = "1" ] && getent group "$DIRECTOR_GROUP" >/dev/null 2>&1; then fail "Director scope group still exists at uninstall end: $DIRECTOR_GROUP"; fi; verify_contract_symlinks_absent; $SUDO test ! -e "$INSTALL_META_FILE" || fail "Install metadata still exists at $INSTALL_META_FILE"; $SUDO test ! -e "$INSTALL_REGISTRY_FILE" || fail "Install registry still exists at $INSTALL_REGISTRY_FILE"; $SUDO test ! -e "$NGINX_MANAGED_INCLUDE_FILE" || fail "Managed Nginx include file still exists at $NGINX_MANAGED_INCLUDE_FILE"; }
init_runtime_policy_helper(){ [ -f "$RUNTIME_POLICY_HELPER" ] || return 1; source "$RUNTIME_POLICY_HELPER"; policy_init "$SOURCE_RUNTIME_DIR/cli/ehecoatl.sh"; }
load_identity_metadata() {
  EHECOATL_USER="${EHECOATL_USER:-ehecoatl}"
  EHECOATL_GROUP="${EHECOATL_GROUP:-ehecoatl}"
  EHECOATL_USER_CREATED_BY_INSTALLER="${EHECOATL_USER_CREATED_BY_INSTALLER:-0}"
  EHECOATL_GROUP_CREATED_BY_INSTALLER="${EHECOATL_GROUP_CREATED_BY_INSTALLER:-0}"
  INSTALL_ID="${INSTALL_ID:-}"
  SUPERVISOR_USER="${SUPERVISOR_USER:-}"
  SUPERVISOR_GROUP="${SUPERVISOR_GROUP:-g_superScope}"
  SUPERVISOR_USER_CREATED_BY_INSTALLER="${SUPERVISOR_USER_CREATED_BY_INSTALLER:-0}"
  SUPERVISOR_GROUP_CREATED_BY_INSTALLER="${SUPERVISOR_GROUP_CREATED_BY_INSTALLER:-0}"
  DIRECTOR_GROUP="${DIRECTOR_GROUP:-g_directorScope}"
  DIRECTOR_GROUP_CREATED_BY_INSTALLER="${DIRECTOR_GROUP_CREATED_BY_INSTALLER:-0}"
}
remove_runtime_identities() {
  if [ "$EHECOATL_USER_CREATED_BY_INSTALLER" = "1" ]; then
    if id "$EHECOATL_USER" >/dev/null 2>&1; then run_quiet $SUDO userdel "$EHECOATL_USER"; else log "System user '$EHECOATL_USER' is already absent."; fi
  else
    log "Runtime user '$EHECOATL_USER' was not installer-created; preserving it."
  fi
  if [ "$SUPERVISOR_USER_CREATED_BY_INSTALLER" = "1" ]; then
    if id "$SUPERVISOR_USER" >/dev/null 2>&1; then run_quiet $SUDO userdel "$SUPERVISOR_USER"; else log "System user '$SUPERVISOR_USER' is already absent."; fi
  else
    log "Supervisor scope user '$SUPERVISOR_USER' was not installer-created; preserving it."
  fi
  if [ "$EHECOATL_GROUP_CREATED_BY_INSTALLER" = "1" ]; then
    if getent group "$EHECOATL_GROUP" >/dev/null 2>&1; then run_quiet $SUDO groupdel "$EHECOATL_GROUP"; else log "System group '$EHECOATL_GROUP' is already absent."; fi
  else
    log "Runtime group '$EHECOATL_GROUP' was not installer-created; preserving it."
  fi
  if [ "$SUPERVISOR_GROUP_CREATED_BY_INSTALLER" = "1" ]; then
    if getent group "$SUPERVISOR_GROUP" >/dev/null 2>&1; then run_quiet $SUDO groupdel "$SUPERVISOR_GROUP"; else log "System group '$SUPERVISOR_GROUP' is already absent."; fi
  else
    log "Supervisor scope group '$SUPERVISOR_GROUP' was not installer-created; preserving it."
  fi
  if [ "$DIRECTOR_GROUP_CREATED_BY_INSTALLER" = "1" ]; then
    if getent group "$DIRECTOR_GROUP" >/dev/null 2>&1; then run_quiet $SUDO groupdel "$DIRECTOR_GROUP"; else log "System group '$DIRECTOR_GROUP' is already absent."; fi
  else
    log "Director scope group '$DIRECTOR_GROUP' was not installer-created; preserving it."
  fi
}
step() { local step_number="$1"; shift; CURRENT_STEP="[$step_number] $*"; log "$CURRENT_STEP"; }
trap 'fail "Command failed on line $LINENO."' ERR
parse_args(){ while [ $# -gt 0 ]; do case "$1" in -h|--help) print_help; exit 0 ;; --yes) YES_MODE=1 ;; --non-interactive) NON_INTERACTIVE=1 ;; --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;; --purge) PURGE_AFTER_UNINSTALL=1 ;; *) fail "Unknown option: $1" ;; esac; shift; done; }
require_root(){ if [ "$DRY_RUN" -eq 1 ]; then return 0; fi; if [ "$(id -u)" -eq 0 ]; then return 0; fi; if command -v sudo >/dev/null 2>&1; then [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "uninstall.sh could not acquire root privileges through sudo."; exec sudo EHECOATL_SETUP_SUDO_REEXEC=1 bash "$0" "${SCRIPT_ARGS[@]}"; fi; fail "uninstall.sh must be run as root. sudo is not available on this host."; }
SUDO=""
PROJECT_DIR="$INSTALL_DIR"
parse_args "$@"
require_root
verify_local_project_matches_install
if $SUDO test -f "$INSTALL_META_FILE"; then metadata_content="$($SUDO cat "$INSTALL_META_FILE")"; eval "$metadata_content"; fi
load_identity_metadata
if [ "${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}" != "$DEFAULT_PROJECT_DIR" ]; then fail "Install metadata points to an unexpected project path ($PROJECT_DIR). Refusing to remove anything outside $DEFAULT_PROJECT_DIR."; fi
POLICY_PROJECT_DIR="$SOURCE_RUNTIME_DIR"; POLICY_FILE="$SOURCE_RUNTIME_DIR/config/runtime-policy.json"
if init_runtime_policy_helper && [ -f "$POLICY_FILE" ]; then CLI_TARGET="/usr/local/bin/ehecoatl"; ETC_BASE_DIR="$(policy_value 'paths.etcBase')"; INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"; fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "Dry run summary:"
  log "What will be removed:"
  log "  - CLI symlink at $CLI_TARGET"
  log "  - Project directory at ${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"
  [ "${EHECOATL_USER_CREATED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-created runtime user: $EHECOATL_USER"
  [ "${SUPERVISOR_USER_CREATED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-created supervisor scope user: $SUPERVISOR_USER"
  [ "${EHECOATL_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-created runtime group: $EHECOATL_GROUP"
  [ "${SUPERVISOR_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-created supervisor scope group: $SUPERVISOR_GROUP"
  [ "${DIRECTOR_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-created director scope group: $DIRECTOR_GROUP"
  [ "${NGINX_MANAGED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-managed Nginx package: ${NGINX_PACKAGE_NAME:-unknown}"
  [ "${LETS_ENCRYPT_MANAGED_BY_INSTALLER:-0}" = "1" ] && log "  - Installer-managed Let's Encrypt package: ${LETS_ENCRYPT_PACKAGE_NAME:-unknown}"
  log "  - Install metadata at $INSTALL_META_FILE"
  log "  - Install registry at $INSTALL_REGISTRY_FILE"
  log "  - Contract-defined symlinks under /root/ehecoatl"
  log "What will be changed:"
  log "  - Stop/disable Ehecoatl service and clear PM2 entry"
  [ "$PURGE_AFTER_UNINSTALL" -eq 1 ] && log "  - Run setup/uninstall/purge-data.sh after uninstall"
  [ "${NGINX_MANAGED_BY_INSTALLER:-0}" = "1" ] && log "  - Stop/disable Nginx service: ${NGINX_SERVICE_NAME:-unknown}"
  log "What will be preserved:"
  log "  - Custom data in /etc/opt/ehecoatl, /var/opt/ehecoatl, and /srv/opt/ehecoatl"
  log "  - Redis"
  log "  - Host prerequisites installed by downloader/bootstrap/setup"
  [ "${NGINX_MANAGED_BY_INSTALLER:-0}" = "1" ] || log "  - External or pre-existing Nginx installations"
  [ "${LETS_ENCRYPT_MANAGED_BY_INSTALLER:-0}" = "1" ] || log "  - External or pre-existing Let's Encrypt client installations"
  exit 0
fi

require_secure_confirmation
step 1 "Removing CLI command"
if [ -L "$CLI_TARGET" ] || [ -f "$CLI_TARGET" ]; then run_quiet $SUDO rm -f "$CLI_TARGET"; fi

step 2 "Removing project files"
clear_pm2_app_entry
clear_systemd_service_entry
remove_contract_symlinks
remove_welcome_page_target_if_managed
run_quiet $SUDO rm -f "$NGINX_MANAGED_INCLUDE_FILE"
if [ -n "${PROJECT_DIR:-}" ] && [ -d "$PROJECT_DIR" ]; then run_quiet $SUDO rm -rf "$PROJECT_DIR"; else log "Project directory not found, skipping."; fi

step 3 "Removing installer-created runtime identities"
remove_runtime_identities

step 4 "Removing installer-managed Nginx"
remove_nginx_package

step 5 "Removing installer-managed Let's Encrypt"
remove_lets_encrypt_package

step 6 "Removing installation metadata"
run_quiet $SUDO rm -f "$INSTALL_META_FILE"
run_quiet $SUDO rm -f "$INSTALL_REGISTRY_FILE"

step 7 "Verifying uninstall state"
verify_uninstall_state

step 8 "Finishing"
log "Ehecoatl binaries/project removed."
if [ "${EHECOATL_USER_CREATED_BY_INSTALLER:-0}" = "1" ] || [ "${SUPERVISOR_USER_CREATED_BY_INSTALLER:-0}" = "1" ] || [ "${EHECOATL_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ] || [ "${SUPERVISOR_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ] || [ "${DIRECTOR_GROUP_CREATED_BY_INSTALLER:-0}" = "1" ]; then log "Installer-created runtime users/groups removed when present."; else log "Pre-existing runtime users/groups were preserved."; fi
log "Custom data in /etc/opt/ehecoatl, /var/opt/ehecoatl, and /srv/opt/ehecoatl was preserved."
log "Host prerequisites installed by downloader/bootstrap/setup were intentionally preserved."
if [ "${NGINX_MANAGED_BY_INSTALLER:-0}" = "1" ]; then log "Installer-managed Nginx package removed."; else log "External or pre-existing Nginx installations were preserved."; fi
if [ "${LETS_ENCRYPT_MANAGED_BY_INSTALLER:-0}" = "1" ]; then log "Installer-managed Let's Encrypt client package removed."; else log "External or pre-existing Let's Encrypt client installations were preserved."; fi
log "Redis was intentionally left untouched. Run setup/uninstall/uninstall-redis.sh only if Ehecoatl previously managed a local Redis installation."
if [ "$PURGE_AFTER_UNINSTALL" -eq 1 ]; then
  step 9 "Running purge-data"
  purge_args=()
  [ "$YES_MODE" -eq 1 ] && purge_args+=("--yes")
  [ "$NON_INTERACTIVE" -eq 1 ] && purge_args+=("--non-interactive")
  [ "$DRY_RUN" -eq 1 ] && purge_args+=("--dry-run")
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] bash $SCRIPT_DIR/uninstall/purge-data.sh ${purge_args[*]}"
  else
    bash "$SCRIPT_DIR/uninstall/purge-data.sh" "${purge_args[@]}"
  fi
fi
