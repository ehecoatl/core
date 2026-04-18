#!/bin/bash
set -eEuo pipefail

# Setup flow:
# 1. Prepare setup execution and parse installation arguments.
# 2. Validate that the local project checkout contains ehecoatl-runtime.
# 3. Load runtime policy values and derive managed paths and runtime users from the local project.
# 4. Clean stale runtime leftovers from previous process managers or broken installs.
# 5. Install required non-Node system dependencies.
# 6. Verify that Node.js 24 with npm is already available.
# 7. Publish the local ehecoatl-runtime payload into the target installation directory.
# 8. Install Node.js application dependencies with npm in the target installation directory.
# 9. Create the shared runtime group.
# 10. Create the shared runtime user.
# 11. Create the supervision scope group and auto-generated scope user.
# 12. Publish the Ehecoatl CLI symlink in /usr/local/bin.
# 13. Create the standard /var, /srv, and /etc directory layout.
# 14. Apply ownership and permission rules to the standard directories.
# 15. Materialize root-only administrative symlinks from the internal-scope contract.
# 16. Grant runtime users read and traversal access to the project tree.
# 17. Optionally scaffold the first tenant when running interactively.
# 18. Install and enable the systemd service unit for Ehecoatl.
# 19. Write installation metadata to /etc/opt/ehecoatl/install-meta.env.
# 20. Verify the final setup state.
# 21. Log final installation status and next-step commands.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_RUNTIME_DIR="$SOURCE_PROJECT_DIR/ehecoatl-runtime"
DEFAULT_PROJECT_DIR="/opt/ehecoatl"
INSTALL_DIR="$DEFAULT_PROJECT_DIR"
CLI_BASE_DIR="$INSTALL_DIR/cli"
CLI_TARGET="/usr/local/bin/ehecoatl"
SYSTEMD_TEMPLATE="$INSTALL_DIR/systemd/ehecoatl.service"
SYSTEMD_UNIT_NAME="ehecoatl.service"
SYSTEMD_UNIT_PATH="/etc/systemd/system/$SYSTEMD_UNIT_NAME"
WELCOME_PAGE_SOURCE="$INSTALL_DIR/welcome-ehecoatl.htm"
WELCOME_PAGE_TARGET="/var/www/html/index.nginx-debian.html"
VAR_BASE_DIR="/var/opt/ehecoatl"
TENANTS_BASE_DIR=""
SRV_BASE_DIR="/srv/opt/ehecoatl"
ETC_BASE_DIR="/etc/opt/ehecoatl"
ETC_CONFIG_DIR="$ETC_BASE_DIR/config"
ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"
ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"
INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
EHECOATL_USER="ehecoatl"
EHECOATL_GROUP="ehecoatl"
EHECOATL_GROUP_CREATED_BY_INSTALLER=0
EHECOATL_USER_CREATED_BY_INSTALLER=0
INSTALL_ID=""
SUPERVISOR_USER=""
SUPERVISOR_GROUP="g_superScope"
SUPERVISOR_USER_CREATED_BY_INSTALLER=0
SUPERVISOR_GROUP_CREATED_BY_INSTALLER=0
DIRECTOR_GROUP="g_directorScope"
DIRECTOR_GROUP_CREATED_BY_INSTALLER=0
CURRENT_STEP=""
SCRIPT_ARGS=("$@")
INSTALL_CALLED_FROM_BOOTSTRAP="${EHECOATL_INSTALL_CALLED_FROM_BOOTSTRAP:-0}"
INSTALL_ESCALATED_TO_BOOTSTRAP="${EHECOATL_INSTALL_ESCALATED_TO_BOOTSTRAP:-0}"
FORCE_INSTALL=0
YES_MODE=0
NON_INTERACTIVE=0
DRY_RUN=0
RUNTIME_POLICY_HELPER="$SOURCE_RUNTIME_DIR/cli/lib/runtime-policy.sh"
SETUP_TOPOLOGY_DERIVER="$SOURCE_RUNTIME_DIR/contracts/derive-setup-topology.js"
SETUP_SYMLINKS_DERIVER="$SOURCE_RUNTIME_DIR/contracts/derive-setup-symlinks.js"
SETUP_IDENTITIES_DERIVER="$SOURCE_RUNTIME_DIR/contracts/derive-setup-identities.js"
INSTALL_REGISTRY_FILE=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() { printf '%s[EHECOATL INSTALL]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
warn() { printf '%s[WARN]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"; }
fail() { printf '[ERROR] Step failed: %s\n' "${CURRENT_STEP:-unknown}" >&2; [ -z "${1:-}" ] || printf '[ERROR] %s\n' "$1" >&2; exit 1; }
run_quiet() {
  local output
  if [ "$DRY_RUN" -eq 1 ]; then log "[dry-run] $*"; return 0; fi
  if ! output="$("$@" 2>&1)"; then fail "$output"; fi
}
clear_systemd_service_entry() {
  command -v systemctl >/dev/null 2>&1 || return 0
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $SUDO systemctl disable --now $SYSTEMD_UNIT_NAME"
    log "[dry-run] $SUDO rm -f $SYSTEMD_UNIT_PATH"
    log "[dry-run] $SUDO systemctl daemon-reload"
    log "[dry-run] $SUDO systemctl reset-failed $SYSTEMD_UNIT_NAME"
    return 0
  fi
  $SUDO systemctl disable --now "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
  $SUDO rm -f "$SYSTEMD_UNIT_PATH"
  $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
  $SUDO systemctl reset-failed "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || true
}
cleanup_stale_cli_target() { if [ -L "$CLI_TARGET" ] && [ ! -e "$CLI_TARGET" ]; then run_quiet $SUDO rm -f "$CLI_TARGET"; fi; }
cleanup_stale_install_metadata() {
  if ! $SUDO test -f "$INSTALL_META_FILE"; then return 0; fi
  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$metadata_project_dir" ] || [ ! -d "$metadata_project_dir" ]; then run_quiet $SUDO rm -f "$INSTALL_META_FILE"; fi
}
step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}
trap 'fail "Command failed on line $LINENO."' ERR

print_help() {
  cat <<'EOF'
Usage: setup/install.sh [options]

Publishes the local ehecoatl-runtime checkout into /opt/ehecoatl, installs npm
dependencies in the active installation, materializes the standard topology,
and installs the systemd service.

Options:
  --force             Reinstall over an existing installation.
  --yes               Accept confirmation prompts automatically.
  --non-interactive   Disable interactive prompts.
  --dry-run           Print planned actions without executing them.
  -h, --help          Show this help message.
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help)
        print_help
        exit 0
        ;;
      --force) FORCE_INSTALL=1 ;;
      --yes) YES_MODE=1 ;;
      --non-interactive) NON_INTERACTIVE=1 ;;
      --dry-run) DRY_RUN=1; NON_INTERACTIVE=1 ;;
      *) fail "Unknown option: $1" ;;
    esac
    shift
  done
}
require_root() {
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "install.sh could not acquire root privileges through sudo."
    exec sudo EHECOATL_SETUP_SUDO_REEXEC=1 bash "$0" "${SCRIPT_ARGS[@]}"
  fi
  fail "install.sh must be run as root. sudo is not available on this host."
}
ensure_bootstrap_complete_when_metadata_missing() {
  local bootstrap_args=()

  [ "$INSTALL_CALLED_FROM_BOOTSTRAP" = "1" ] && return 0
  $SUDO test -f "$INSTALL_META_FILE" && return 0

  if [ "$INSTALL_ESCALATED_TO_BOOTSTRAP" = "1" ]; then
    fail "install.sh required bootstrap complete because install metadata was missing, but bootstrap handoff did not restore $INSTALL_META_FILE."
  fi

  log "Install metadata is missing at $INSTALL_META_FILE. Re-running through bootstrap complete before continuing install."

  bootstrap_args+=("--complete")
  [ "$YES_MODE" -eq 1 ] && bootstrap_args+=("--yes")
  [ "$NON_INTERACTIVE" -eq 1 ] && bootstrap_args+=("--non-interactive")
  [ "$DRY_RUN" -eq 1 ] && bootstrap_args+=("--dry-run")

  exec env EHECOATL_INSTALL_ESCALATED_TO_BOOTSTRAP=1 bash "$SCRIPT_DIR/bootstrap.sh" "${bootstrap_args[@]}"
}
SUDO=""
require_command() { command -v "$1" >/dev/null 2>&1; }
node_major_version() { require_command node || return 1; node -p "process.versions.node.split('.')[0]" 2>/dev/null; }
check_nodejs_24() { local current_major; current_major="$(node_major_version || true)"; [ "$current_major" = "24" ] && require_command npm; }
init_runtime_policy_helper() {
  [ -f "$RUNTIME_POLICY_HELPER" ] || fail "Project runtime policy helper not found at $RUNTIME_POLICY_HELPER."
  # shellcheck source=/dev/null
  source "$RUNTIME_POLICY_HELPER"
  policy_init "$SOURCE_RUNTIME_DIR/cli/ehecoatl.sh"
}
install_system_dependencies() {
  local need_install=0 required_commands=(python3 make iptables curl rsync) command_name
  for command_name in "${required_commands[@]}"; do if ! require_command "$command_name"; then need_install=1; break; fi; done
  if [ "$need_install" -eq 0 ] && command -v setfacl >/dev/null 2>&1 && require_command g++ && [ -f /usr/include/seccomp.h ]; then return 0; fi
  if require_command apt-get; then
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl python3 make g++ iptables acl libseccomp-dev rsync
    return 0
  fi
  if require_command dnf; then
    run_quiet $SUDO dnf install -y curl python3 make gcc-c++ iptables acl ca-certificates libseccomp-devel rsync
    return 0
  fi
  fail "Could not install dependencies automatically. Please install python3, make, curl, iptables, acl, rsync, libseccomp development headers, and a C++ compiler manually."
}
verify_seccomp_addon_build() {
  local addon_path="$INSTALL_DIR/utils/process/seccomp/build/Release/ehecoatl_seccomp.node"
  [ "$(uname -s)" = "Linux" ] || return 0
  [ -f "$INSTALL_DIR/utils/process/seccomp/binding.gyp" ] || return 0
  if [ -f "$addon_path" ]; then
    return 0
  fi
  log "Building seccomp addon explicitly"
  run_quiet node ./scripts/build-seccomp-addon.js
  [ -f "$addon_path" ] || fail "Seccomp addon build did not produce $addon_path. Verify libseccomp development headers are installed."
}
load_runtime_policy() {
  POLICY_PROJECT_DIR="$SOURCE_RUNTIME_DIR"; POLICY_FILE="$SOURCE_RUNTIME_DIR/config/runtime-policy.json"; POLICY_DERIVER="$SOURCE_RUNTIME_DIR/contracts/derive-runtime-policy.js"
  VAR_BASE_DIR="$(policy_value 'paths.varBase')"; SRV_BASE_DIR="$(policy_value 'paths.srvBase')"; ETC_BASE_DIR="$(policy_value 'paths.etcBase')"
  TENANTS_BASE_DIR="$(policy_value 'paths.tenantsBase')"
  ETC_CONFIG_DIR="$ETC_BASE_DIR/config"; ETC_ADAPTERS_DIR="$ETC_BASE_DIR/adapters"; ETC_PLUGINS_DIR="$ETC_BASE_DIR/plugins"; INSTALL_META_FILE="$ETC_BASE_DIR/install-meta.env"
  EHECOATL_USER="$(policy_value 'system.sharedUser')"; EHECOATL_GROUP="$(policy_value 'system.sharedGroup')"
}
publish_runtime_payload() {
  [ -d "$SOURCE_RUNTIME_DIR" ] || fail "ehecoatl-runtime source payload not found at $SOURCE_RUNTIME_DIR"
  run_quiet $SUDO mkdir -p "$INSTALL_DIR"
  run_quiet $SUDO rsync -a --delete --exclude 'node_modules/' "$SOURCE_RUNTIME_DIR"/ "$INSTALL_DIR"/
}
install_welcome_page_if_nginx_available() {
  if ! require_command nginx; then
    log "Skipping welcome page installation because nginx is not available on this host."
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] replace $WELCOME_PAGE_TARGET with symlink to $WELCOME_PAGE_SOURCE"
    return 0
  fi

  $SUDO test -f "$WELCOME_PAGE_SOURCE" || fail "Welcome page source not found at $WELCOME_PAGE_SOURCE"
  run_quiet $SUDO mkdir -p "$(dirname "$WELCOME_PAGE_TARGET")"
  if $SUDO test -e "$WELCOME_PAGE_TARGET" || $SUDO test -L "$WELCOME_PAGE_TARGET"; then
    run_quiet $SUDO rm -f "$WELCOME_PAGE_TARGET"
  fi
  run_quiet $SUDO ln -s "$WELCOME_PAGE_SOURCE" "$WELCOME_PAGE_TARGET"
}
derive_install_package_version() {
  local derived_version
  derived_version="$(infer_source_release_from_checkout || true)"
  [ -n "$derived_version" ] || fail "Could not derive package version from checkout path. Expected setup under a versioned folder such as ~/ehecoatl/0.0.1/setup/."
  printf '%s\n' "$derived_version"
}
write_installed_package_version() {
  local install_package_json="$INSTALL_DIR/package.json"
  local package_version="$1"
  [ -f "$install_package_json" ] || fail "Installed runtime package.json not found at $install_package_json"
  [ -n "$package_version" ] || fail "Installed package version cannot be empty."
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] set package.json version at $install_package_json to $package_version"
    return 0
  fi
  local node_script
  node_script='
const fs = require("node:fs");
const filePath = process.argv[1];
const packageVersion = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
pkg.version = packageVersion;
fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
'
  local output
  if ! output="$($SUDO node -e "$node_script" "$install_package_json" "$package_version" 2>&1)"; then
    fail "$output"
  fi
}
derive_setup_identity_value() {
  local dotted_path="$1"
  local install_id_arg="${2:-$INSTALL_ID}"
  node "$SETUP_IDENTITIES_DERIVER" value "$dotted_path" "$install_id_arg"
}
read_existing_registry_value() {
  local dotted_path="$1"
  [ -n "${INSTALL_REGISTRY_FILE:-}" ] && $SUDO test -f "$INSTALL_REGISTRY_FILE" || return 1
  node -e '
    const fs = require(`node:fs`);
    const data = JSON.parse(fs.readFileSync(process.argv[1], `utf8`));
    const value = String(process.argv[2] ?? ``).split(`.`).reduce((current, key) => current?.[key], data);
    if (value === undefined || value === null) process.exit(2);
    process.stdout.write(String(value));
  ' "$INSTALL_REGISTRY_FILE" "$dotted_path"
}
resolve_install_identity() {
  INSTALL_ID="$(read_existing_metadata_value INSTALL_ID || true)"
  [ -n "$INSTALL_ID" ] || INSTALL_ID="$(read_existing_registry_value installId || true)"
  [ -n "$INSTALL_ID" ] || INSTALL_ID="$(node "$SETUP_IDENTITIES_DERIVER" generate-install-id)"

  SUPERVISOR_GROUP="$(derive_setup_identity_value supervisor.group "$INSTALL_ID")"
  SUPERVISOR_USER="$(derive_setup_identity_value supervisor.user "$INSTALL_ID")"
  INSTALL_REGISTRY_FILE="$(derive_setup_identity_value registryFile "$INSTALL_ID")"
}
detect_existing_install() {
  $SUDO test -f "$INSTALL_META_FILE" || return 1
  local metadata_content metadata_project_dir
  metadata_content="$($SUDO cat "$INSTALL_META_FILE")"
  metadata_project_dir="$(printf '%s\n' "$metadata_content" | sed -n 's/^PROJECT_DIR="\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$metadata_project_dir" ] || return 1
  [ -f "$metadata_project_dir/package.json" ] || return 1
  [ -x "$CLI_TARGET" ] || return 1
  $SUDO test -f "$SYSTEMD_UNIT_PATH" || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || return 1
}
apply_owner_group_mode() { local target_path="$1" owner_name="$2" group_name="$3" mode_value="$4"; [ -e "$target_path" ] || return 0; run_quiet $SUDO chown "$owner_name:$group_name" "$target_path"; run_quiet $SUDO chmod "$mode_value" "$target_path"; }
apply_owner_group_mode_recursive() {
  local target_path="$1" owner_name="$2" group_name="$3" mode_value="$4" recursive_flag="${5:-}"
  [ -e "$target_path" ] || return 0

  if [ "$recursive_flag" = "1" ] && [ -d "$target_path" ]; then
    run_quiet $SUDO chown -R "$owner_name:$group_name" "$target_path"
    run_quiet $SUDO chmod -R "$mode_value" "$target_path"
    return 0
  fi

  apply_owner_group_mode "$target_path" "$owner_name" "$group_name" "$mode_value"
}
should_skip_existing_force_topology_path() {
  local target_path="$1"

  [ "$FORCE_INSTALL" -eq 1 ] || return 1
  [ -e "$target_path" ] || return 1

  case "$target_path" in
    "$VAR_BASE_DIR"|"$VAR_BASE_DIR/tenants")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
materialize_contract_topology() {
  [ -f "$SETUP_TOPOLOGY_DERIVER" ] || fail "Setup topology deriver not found at $SETUP_TOPOLOGY_DERIVER"

  while IFS=$'\t' read -r target_path owner_name group_name mode_value recursive_flag path_type; do
    [ -n "${target_path:-}" ] || continue
    if should_skip_existing_force_topology_path "$target_path"; then
      log "Preserving existing runtime data root during force setup: $target_path"
      continue
    fi
    if [ "${path_type:-directory}" = "file" ]; then
      run_quiet $SUDO mkdir -p "$(dirname "$target_path")"
    else
      run_quiet $SUDO mkdir -p "$target_path"
    fi
    apply_owner_group_mode_recursive "$target_path" "$owner_name" "$group_name" "$mode_value" "${recursive_flag:-}"
  done < <(node "$SETUP_TOPOLOGY_DERIVER" tsv)
}
materialize_contract_symlinks() {
  [ -f "$SETUP_SYMLINKS_DERIVER" ] || fail "Setup symlinks deriver not found at $SETUP_SYMLINKS_DERIVER"

  local link_path target_path workspace_dir current_target
  declare -A workspace_dirs=()

  while IFS=$'\t' read -r link_path target_path; do
    [ -n "${link_path:-}" ] || continue
    workspace_dir="$(dirname "$link_path")"

    if [ -z "${workspace_dirs[$workspace_dir]+x}" ]; then
      workspace_dirs["$workspace_dir"]=1
      run_quiet $SUDO mkdir -p "$workspace_dir"
      apply_owner_group_mode "$workspace_dir" root root 0700
    fi

    if $SUDO test -L "$link_path"; then
      current_target="$($SUDO readlink "$link_path")"
      [ "$current_target" = "$target_path" ] && continue
      run_quiet $SUDO rm -f "$link_path"
      run_quiet $SUDO ln -s "$target_path" "$link_path"
      continue
    fi

    if $SUDO test -e "$link_path"; then
      fail "Refusing to replace non-symlink path at $link_path. Remove or rename it manually."
    fi

    run_quiet $SUDO ln -s "$target_path" "$link_path"
  done < <(node "$SETUP_SYMLINKS_DERIVER" tsv)
}
prompt_and_create_first_tenant() {
  local first_tenant_domain cli_entry tenant_root tenant_json deploy_output app_root
  if [ "$NON_INTERACTIVE" -eq 1 ]; then log "Skipping first tenant scaffold in non-interactive mode."; return 0; fi
  printf 'Enter a first tenant domain to scaffold now (example.com or localhost), or leave blank to skip [skip]: '
  read -r first_tenant_domain
  [ -n "${first_tenant_domain:-}" ] || { log "Skipping first tenant scaffold."; return 0; }
  [ -n "${TENANTS_BASE_DIR:-}" ] || fail "Tenants base directory is not configured in runtime policy."
  cli_entry="$CLI_BASE_DIR/ehecoatl.sh"; [ -x "$cli_entry" ] || run_quiet chmod +x "$cli_entry"
  log "Creating first tenant scaffold for domain '$first_tenant_domain' with app 'www'."
  run_quiet "$cli_entry" core deploy tenant "@$first_tenant_domain" -t empty-tenant-kit
  tenant_json="$(node "$CLI_BASE_DIR/lib/tenant-layout-cli.js" find-tenant-json-by-domain "$TENANTS_BASE_DIR" "$first_tenant_domain")"
  tenant_root="$(printf '%s' "$tenant_json" | node -e 'const data = JSON.parse(require(`node:fs`).readFileSync(0, `utf8`)); process.stdout.write(String(data?.tenantRoot ?? ``));')"
  [ -n "$tenant_root" ] || fail "Could not resolve scaffolded tenant root for $first_tenant_domain"
  app_root="$(find "$tenant_root" -maxdepth 1 -mindepth 1 -type d -name 'app_*' | head -n 1 || true)"
  if ! deploy_output="$(bash -lc "cd '$tenant_root' && '$cli_entry' tenant deploy app 'www' -a empty-app-kit" 2>&1)"; then
    app_root="$(find "$tenant_root" -maxdepth 1 -mindepth 1 -type d -name 'app_*' | head -n 1 || true)"
    if printf '%s' "$deploy_output" | grep -qi 'nginx service not found'; then
      warn "First tenant and app were scaffolded, but web publish was skipped because local Nginx is not installed on this host."
      [ -n "$app_root" ] && warn "Created app root: $app_root"
      warn "Install local Nginx with setup/bootstraps/bootstrap-nginx.sh, then rerun 'ehecoatl core rescan tenants'."
      return 0
    fi
    fail "$deploy_output"
  fi
  [ -n "$deploy_output" ] && printf '%s\n' "$deploy_output"
  log "First tenant scaffold created at app route 'www.$first_tenant_domain'."
}
grant_project_runtime_access() {
  [ -n "$INSTALL_DIR" ] || return 0
  command -v setfacl >/dev/null 2>&1 || return 0
  local runtime_users=("$EHECOATL_USER" "root") current_path="$INSTALL_DIR" parent_path runtime_user
  while [ "$current_path" != "/" ]; do parent_path="$(dirname "$current_path")"; [ "$parent_path" = "$current_path" ] && break; for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -m "u:${runtime_user}:x" "$parent_path"; done; current_path="$parent_path"; done
  for runtime_user in "${runtime_users[@]}"; do run_quiet $SUDO setfacl -R -m "u:${runtime_user}:rX" "$INSTALL_DIR"; done
}
read_existing_metadata_value() { local key_name="$1"; $SUDO test -f "$INSTALL_META_FILE" || return 1; $SUDO sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1; }
infer_source_release_from_checkout() {
  local checkout_parent
  [ -n "${SOURCE_PROJECT_DIR:-}" ] || return 1
  checkout_parent="$(dirname "$SOURCE_PROJECT_DIR")"
  [ "$(basename "$checkout_parent")" = "ehecoatl" ] || return 1
  printf '%s\n' "$(basename "$SOURCE_PROJECT_DIR")"
}
infer_source_commit_from_checkout() {
  [ -d "$SOURCE_PROJECT_DIR/.git" ] || return 1
  command -v git >/dev/null 2>&1 || return 1
  git -C "$SOURCE_PROJECT_DIR" rev-parse HEAD 2>/dev/null
}
write_install_metadata() {
  local nginx_package_name nginx_service_name nginx_managed_by_installer
  local redis_package_name redis_service_name redis_managed_by_installer redis_supported_major
  local lets_encrypt_package_name lets_encrypt_managed_by_installer
  local source_release source_commit source_checkout_dir installed_at_utc
  local existing_user_created_by_installer existing_group_created_by_installer
  local resolved_user_created_by_installer resolved_group_created_by_installer
  local existing_supervisor_user_created_by_installer existing_supervisor_group_created_by_installer
  local existing_director_group_created_by_installer
  nginx_package_name="${EHECOATL_NGINX_PACKAGE_NAME:-$(read_existing_metadata_value NGINX_PACKAGE_NAME || true)}"
  nginx_service_name="${EHECOATL_NGINX_SERVICE_NAME:-$(read_existing_metadata_value NGINX_SERVICE_NAME || true)}"
  nginx_managed_by_installer="${EHECOATL_NGINX_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value NGINX_MANAGED_BY_INSTALLER || true)}"
  redis_package_name="${EHECOATL_REDIS_PACKAGE_NAME:-$(read_existing_metadata_value REDIS_PACKAGE_NAME || true)}"
  redis_service_name="${EHECOATL_REDIS_SERVICE_NAME:-$(read_existing_metadata_value REDIS_SERVICE_NAME || true)}"
  redis_managed_by_installer="${EHECOATL_REDIS_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)}"
  redis_supported_major="${EHECOATL_REDIS_SUPPORTED_MAJOR:-$(read_existing_metadata_value REDIS_SUPPORTED_MAJOR || true)}"
  lets_encrypt_package_name="${EHECOATL_LETS_ENCRYPT_PACKAGE_NAME:-$(read_existing_metadata_value LETS_ENCRYPT_PACKAGE_NAME || true)}"
  lets_encrypt_managed_by_installer="${EHECOATL_LETS_ENCRYPT_MANAGED_BY_INSTALLER:-$(read_existing_metadata_value LETS_ENCRYPT_MANAGED_BY_INSTALLER || true)}"
  source_release="${EHECOATL_SOURCE_RELEASE:-$(read_existing_metadata_value SOURCE_RELEASE || true)}"
  source_commit="${EHECOATL_SOURCE_COMMIT:-$(read_existing_metadata_value SOURCE_COMMIT || true)}"
  source_checkout_dir="${EHECOATL_SOURCE_CHECKOUT_DIR:-$(read_existing_metadata_value SOURCE_CHECKOUT_DIR || true)}"
  installed_at_utc="${EHECOATL_INSTALLED_AT_UTC:-$(read_existing_metadata_value INSTALLED_AT_UTC || true)}"
  [ -n "$source_release" ] || source_release="$(infer_source_release_from_checkout || true)"
  [ -n "$source_commit" ] || source_commit="$(infer_source_commit_from_checkout || true)"
  [ -n "$source_checkout_dir" ] || source_checkout_dir="$SOURCE_PROJECT_DIR"
  [ -n "$installed_at_utc" ] || installed_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  existing_user_created_by_installer="$(read_existing_metadata_value EHECOATL_USER_CREATED_BY_INSTALLER || true)"
  existing_group_created_by_installer="$(read_existing_metadata_value EHECOATL_GROUP_CREATED_BY_INSTALLER || true)"
  existing_supervisor_user_created_by_installer="$(read_existing_metadata_value SUPERVISOR_USER_CREATED_BY_INSTALLER || true)"
  existing_supervisor_group_created_by_installer="$(read_existing_metadata_value SUPERVISOR_GROUP_CREATED_BY_INSTALLER || true)"
  existing_director_group_created_by_installer="$(read_existing_metadata_value DIRECTOR_GROUP_CREATED_BY_INSTALLER || true)"
  resolved_user_created_by_installer="$EHECOATL_USER_CREATED_BY_INSTALLER"
  [ "$resolved_user_created_by_installer" = "1" ] || resolved_user_created_by_installer="${existing_user_created_by_installer:-0}"
  resolved_group_created_by_installer="$EHECOATL_GROUP_CREATED_BY_INSTALLER"
  [ "$resolved_group_created_by_installer" = "1" ] || resolved_group_created_by_installer="${existing_group_created_by_installer:-0}"
  local metadata
  metadata=$(cat <<EOF_META
PROJECT_DIR="$INSTALL_DIR"
DEFAULT_PROJECT_DIR="$DEFAULT_PROJECT_DIR"
CLI_TARGET="$CLI_TARGET"
VAR_BASE_DIR="$VAR_BASE_DIR"
SRV_BASE_DIR="$SRV_BASE_DIR"
ETC_BASE_DIR="$ETC_BASE_DIR"
SOURCE_RELEASE="${source_release:-}"
SOURCE_COMMIT="${source_commit:-}"
SOURCE_CHECKOUT_DIR="${source_checkout_dir:-}"
INSTALLED_AT_UTC="${installed_at_utc:-}"
EHECOATL_USER="$EHECOATL_USER"
EHECOATL_GROUP="$EHECOATL_GROUP"
INSTALL_ID="$INSTALL_ID"
SUPERVISOR_USER="$SUPERVISOR_USER"
SUPERVISOR_GROUP="$SUPERVISOR_GROUP"
DIRECTOR_GROUP="$DIRECTOR_GROUP"
EHECOATL_USER_CREATED_BY_INSTALLER="$resolved_user_created_by_installer"
EHECOATL_GROUP_CREATED_BY_INSTALLER="$resolved_group_created_by_installer"
SUPERVISOR_USER_CREATED_BY_INSTALLER="${SUPERVISOR_USER_CREATED_BY_INSTALLER:-${existing_supervisor_user_created_by_installer:-0}}"
SUPERVISOR_GROUP_CREATED_BY_INSTALLER="${SUPERVISOR_GROUP_CREATED_BY_INSTALLER:-${existing_supervisor_group_created_by_installer:-0}}"
DIRECTOR_GROUP_CREATED_BY_INSTALLER="${DIRECTOR_GROUP_CREATED_BY_INSTALLER:-${existing_director_group_created_by_installer:-0}}"
INSTALLER_PACKAGE_MANAGER="${EHECOATL_INSTALLER_PACKAGE_MANAGER:-}"
INSTALLER_MANAGED_PACKAGES="${EHECOATL_INSTALLER_MANAGED_PACKAGES:-}"
NGINX_PACKAGE_NAME="${nginx_package_name:-}"
NGINX_SERVICE_NAME="${nginx_service_name:-}"
NGINX_MANAGED_BY_INSTALLER="${nginx_managed_by_installer:-0}"
REDIS_PACKAGE_NAME="${redis_package_name:-}"
REDIS_SERVICE_NAME="${redis_service_name:-}"
REDIS_MANAGED_BY_INSTALLER="${redis_managed_by_installer:-0}"
REDIS_SUPPORTED_MAJOR="${redis_supported_major:-}"
LETS_ENCRYPT_PACKAGE_NAME="${lets_encrypt_package_name:-}"
LETS_ENCRYPT_MANAGED_BY_INSTALLER="${lets_encrypt_managed_by_installer:-0}"
EOF_META
)
  run_quiet $SUDO mkdir -p "$ETC_BASE_DIR"
  if ! printf '%s\n' "$metadata" | { [ "$DRY_RUN" -eq 1 ] && cat >/dev/null || $SUDO tee "$INSTALL_META_FILE" >/dev/null; }; then fail "Could not write install metadata to $INSTALL_META_FILE"; fi
  [ "$DRY_RUN" -eq 1 ] || apply_owner_group_mode "$INSTALL_META_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 644
}
write_install_registry() {
  local registry_dir registry_json
  registry_dir="$(dirname "$INSTALL_REGISTRY_FILE")"
  registry_json=$(cat <<EOF_REGISTRY
{
  "installId": "$INSTALL_ID",
  "internal": {
    "user": "$EHECOATL_USER",
    "group": "$EHECOATL_GROUP"
  },
  "supervisor": {
    "user": "$SUPERVISOR_USER",
    "group": "$SUPERVISOR_GROUP"
  },
  "director": {
    "group": "$DIRECTOR_GROUP"
  },
  "writtenAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF_REGISTRY
)
  run_quiet $SUDO mkdir -p "$registry_dir"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write install registry to $INSTALL_REGISTRY_FILE"
    return 0
  fi
  printf '%s\n' "$registry_json" | $SUDO tee "$INSTALL_REGISTRY_FILE" >/dev/null
  apply_owner_group_mode "$INSTALL_REGISTRY_FILE" "$EHECOATL_USER" "$EHECOATL_GROUP" 640
}
verify_setup_state() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -x "$CLI_TARGET" ] || fail "CLI target not available at $CLI_TARGET"
  [ -f "$INSTALL_DIR/package.json" ] || fail "Installed runtime package.json not found at $INSTALL_DIR/package.json"
  [ -x "$INSTALL_DIR/cli/ehecoatl.sh" ] || fail "CLI dispatcher is not executable at $INSTALL_DIR/cli/ehecoatl.sh"
  [ -f "$INSTALL_DIR/systemd/ehecoatl.service" ] || fail "Systemd template not found at $INSTALL_DIR/systemd/ehecoatl.service"
  $SUDO test -f "$INSTALL_META_FILE" || fail "Install metadata not found at $INSTALL_META_FILE"
  $SUDO test -f "$INSTALL_REGISTRY_FILE" || fail "Install registry not found at $INSTALL_REGISTRY_FILE"
  id "$SUPERVISOR_USER" >/dev/null 2>&1 || fail "Auto-generated supervision scope user not found: $SUPERVISOR_USER"
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required but unavailable."
  $SUDO systemctl is-enabled "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not enabled."
  $SUDO systemctl is-active "$SYSTEMD_UNIT_NAME" >/dev/null 2>&1 || fail "Service $SYSTEMD_UNIT_NAME is not active."
  wait_for_director_ready
}
wait_for_director_ready() {
  local cli_entry director_rpc_cli socket_path timeout_seconds=90 elapsed=0
  cli_entry="$CLI_BASE_DIR/ehecoatl.sh"
  director_rpc_cli="$CLI_BASE_DIR/lib/director-rpc-cli.js"

  [ -x "$cli_entry" ] || fail "CLI dispatcher is not executable at $cli_entry"
  [ -f "$director_rpc_cli" ] || fail "Director RPC CLI helper not found at $director_rpc_cli"

  socket_path="$(node -e 'const { getDirectorRpcSocketPath } = require(process.argv[1]); process.stdout.write(getDirectorRpcSocketPath());' "$INSTALL_DIR/utils/process/director-rpc-socket.js")" \
    || fail "Could not resolve director RPC socket path from the installed runtime."

  log "Waiting for director readiness via $socket_path"
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if $SUDO test -S "$socket_path"; then
      if node "$director_rpc_cli" rescan-tenants --json >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  fail "Director did not become ready within ${timeout_seconds}s. Service may be running, but the director RPC socket is still unavailable or not responding."
}
install_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for runtime service setup."
  [ -f "$SYSTEMD_TEMPLATE" ] || fail "Systemd template not found at $SYSTEMD_TEMPLATE"
  local escaped_project_dir; escaped_project_dir="$(printf '%s\n' "$INSTALL_DIR" | sed 's/[\/&]/\\&/g')"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write systemd unit to $SYSTEMD_UNIT_PATH from $SYSTEMD_TEMPLATE"
    log "[dry-run] $SUDO systemctl daemon-reload"
    log "[dry-run] $SUDO systemctl enable --now $SYSTEMD_UNIT_NAME"
    return 0
  fi
  if ! sed "s/__PROJECT_DIR__/$escaped_project_dir/g" "$SYSTEMD_TEMPLATE" | $SUDO tee "$SYSTEMD_UNIT_PATH" >/dev/null; then fail "Could not write systemd unit at $SYSTEMD_UNIT_PATH"; fi
  run_quiet $SUDO chmod 644 "$SYSTEMD_UNIT_PATH"
  run_quiet $SUDO systemctl daemon-reload
  run_quiet $SUDO systemctl enable --now "$SYSTEMD_UNIT_NAME"
}
is_source_runtime_available() {
  [ -d "$SOURCE_RUNTIME_DIR" ] && [ -f "$SOURCE_RUNTIME_DIR/package.json" ]
}
is_redis_enabled_from_metadata() {
  local redis_managed_by_installer
  redis_managed_by_installer="$(read_existing_metadata_value REDIS_MANAGED_BY_INSTALLER || true)"
  [ "$redis_managed_by_installer" = "1" ]
}
write_split_json_config() {
  local source_config="$SOURCE_RUNTIME_DIR/config/default.config.js"
  local target_dir="$ETC_CONFIG_DIR"
  local redis_enabled="0"

  [ -f "$source_config" ] || fail "Default config file not found at $source_config"

  if is_redis_enabled_from_metadata; then
    redis_enabled="1"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FORCE_INSTALL" -eq 1 ]; then
      log "[dry-run] Regenerate runtime/*.json, plugins/*.json, and adapters/*.json in $target_dir from $source_config"
    else
      log "[dry-run] Create missing runtime/*.json, plugins/*.json, and adapters/*.json in $target_dir from $source_config"
    fi
    if [ "$redis_enabled" = "1" ]; then
      log "[dry-run] Force adapters/sharedCacheService.json adapter=redis because install metadata indicates Redis is enabled"
    fi
    return 0
  fi

  run_quiet $SUDO mkdir -p "$target_dir"

  local node_script
  node_script='
const fs = require("fs");
const path = require("path");

const sourceConfig = process.argv[1];
const targetDir = process.argv[2];
const forceMode = process.argv[3] === "1";
const redisEnabled = process.argv[4] === "1";

const loaded = require(sourceConfig);
const config = loaded && loaded.default ? loaded.default : loaded;

if (!config || typeof config !== "object" || Array.isArray(config)) {
  console.error("default.config.js must export a plain object at the root.");
  process.exit(1);
}

if (redisEnabled) {
  if (!config.adapters || typeof config.adapters !== "object" || Array.isArray(config.adapters)) {
    config.adapters = {};
  }
  if (!config.adapters.sharedCacheService || typeof config.adapters.sharedCacheService !== "object" || Array.isArray(config.adapters.sharedCacheService)) {
    config.adapters.sharedCacheService = {};
  }
  config.adapters.sharedCacheService.adapter = "redis";
}

fs.mkdirSync(targetDir, { recursive: true });

const managedKeys = [`runtime`, `plugins`, `adapters`];

for (const key of managedKeys) {
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    console.error(`Root property "${key}" must be a plain object.`);
    process.exit(1);
  }

  const groupDir = path.join(targetDir, key);
  fs.mkdirSync(groupDir, { recursive: true });

  const managedEntries = new Set(Object.keys(value));
  for (const entryName of fs.readdirSync(groupDir)) {
    if (!entryName.toLowerCase().endsWith(`.json`)) continue;
    const baseName = path.basename(entryName, path.extname(entryName));
    if (managedEntries.has(baseName)) continue;
    fs.unlinkSync(path.join(groupDir, entryName));
  }

  const legacyGroupFile = path.join(targetDir, `${key}.json`);
  if (fs.existsSync(legacyGroupFile)) {
    fs.unlinkSync(legacyGroupFile);
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    const outPath = path.join(groupDir, `${entryKey}.json`);
    if (!forceMode && fs.existsSync(outPath)) continue;

    const json = JSON.stringify(entryValue, null, 2);
    if (typeof json !== "string") {
      console.error(`Config property "${key}.${entryKey}" is not JSON-serializable.`);
      process.exit(1);
    }

    fs.writeFileSync(outPath, json + "\n", "utf8");
  }
}
'

  local output
  if ! output="$(node -e "$node_script" "$source_config" "$target_dir" "$FORCE_INSTALL" "$redis_enabled" 2>&1)"; then
    fail "$output"
  fi

  local config_path
  while IFS= read -r config_path; do
    [ -n "$config_path" ] || continue
    if [ -d "$config_path" ]; then
      apply_owner_group_mode "$config_path" "$EHECOATL_USER" "$EHECOATL_GROUP" 755
      continue
    fi
    apply_owner_group_mode "$config_path" "$EHECOATL_USER" "$EHECOATL_GROUP" 644
  done < <(find "$target_dir" -mindepth 1 \( -type d -o -type f -name '*.json' \) | sort)
}
print_dry_run_summary() {
  log "Dry run summary:"
  log "What may be installed:"
  log "  - python3, make, g++, iptables, acl, curl, ca-certificates, rsync, libseccomp development headers when missing"
  log "  - Node.js service dependencies via npm install"
  log "  - system users/groups: $EHECOATL_GROUP, $EHECOATL_USER, $SUPERVISOR_GROUP, $SUPERVISOR_USER, $DIRECTOR_GROUP"
  log "What will be changed:"
  log "  - Publish the local ehecoatl-runtime payload from $SOURCE_RUNTIME_DIR to $INSTALL_DIR"
  log "  - Publish CLI symlink at $CLI_TARGET"
  log "  - Create runtime directories under $ETC_BASE_DIR, $VAR_BASE_DIR, and $SRV_BASE_DIR"
  log "  - Create/update root-only helper symlinks under /root/ehecoatl"
  log "  - Create missing runtime/*.json, plugins/*.json, and adapters/*.json under $ETC_CONFIG_DIR from $SOURCE_RUNTIME_DIR/config/default.config.js"
  log "  - With --force, regenerate runtime/*.json, plugins/*.json, and adapters/*.json under $ETC_CONFIG_DIR"
  log "  - Write/refresh systemd unit at $SYSTEMD_UNIT_PATH"
  log "  - Write install metadata to $INSTALL_META_FILE"
  log "  - Write install registry to $INSTALL_REGISTRY_FILE"
}

# Step 1: Prepare setup execution.
step 1 "Preparing installation"
log "Installing Ehecoatl..."
parse_args "$@"
require_root
ensure_bootstrap_complete_when_metadata_missing

# Step 2: Validate the source project.
step 2 "Validating source project"
is_source_runtime_available || fail "Local ehecoatl-runtime source not found at $SOURCE_RUNTIME_DIR."
init_runtime_policy_helper

# Step 3: Load runtime policy values.
step 3 "Loading runtime policy"
load_runtime_policy
resolve_install_identity
if [ "$DRY_RUN" -eq 1 ]; then print_dry_run_summary; exit 0; fi
if detect_existing_install; then
  if [ "$FORCE_INSTALL" -eq 0 ]; then log "Detected an existing installation. Install will stop without changes."; log "Run setup/install.sh --force to reapply setup and runtime service provisioning."; exit 0; fi
  log "Detected an existing installation; continuing because --force was provided."
fi

# Step 4: Clean stale runtime leftovers.
step 4 "Cleaning stale runtime leftovers"
clear_systemd_service_entry
cleanup_stale_cli_target
cleanup_stale_install_metadata

# Step 5: Install required system dependencies.
step 5 "Installing system dependencies"
install_system_dependencies

# Step 6: Verify the supported Node.js runtime.
step 6 "Checking Node.js version"
check_nodejs_24 || fail "Node.js 24 is required."

# Step 7: Publish the local runtime payload.
step 7 "Publishing runtime payload"
publish_runtime_payload
write_installed_package_version "$(derive_install_package_version)"

# Step 8: Install Node.js application dependencies.
step 8 "Installing Node.js dependencies"
cd "$INSTALL_DIR"
run_quiet npm install --no-fund --no-audit
verify_seccomp_addon_build

# Step 9: Create the shared runtime group.
step 9 "Creating runtime group"
if ! getent group "$EHECOATL_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$EHECOATL_GROUP"
  EHECOATL_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$EHECOATL_GROUP' already exists."
fi

# Step 10: Create the shared runtime user.
step 10 "Creating runtime user"
if ! id "$EHECOATL_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$EHECOATL_GROUP" --no-create-home --shell /usr/sbin/nologin "$EHECOATL_USER"
  EHECOATL_USER_CREATED_BY_INSTALLER=1
else
  log "System user '$EHECOATL_USER' already exists."
  run_quiet $SUDO usermod -g "$EHECOATL_GROUP" "$EHECOATL_USER"
  run_quiet $SUDO usermod -a -G "$EHECOATL_GROUP" "$EHECOATL_USER"
fi

# Step 11: Create the supervision scope group and auto-generated scope user.
step 11 "Creating supervision scope identity"
if ! getent group "$SUPERVISOR_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$SUPERVISOR_GROUP"
  SUPERVISOR_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$SUPERVISOR_GROUP' already exists."
fi
if ! id "$SUPERVISOR_USER" >/dev/null 2>&1; then
  run_quiet $SUDO useradd --system --gid "$SUPERVISOR_GROUP" --no-create-home --shell /usr/sbin/nologin "$SUPERVISOR_USER"
  SUPERVISOR_USER_CREATED_BY_INSTALLER=1
else
  log "System user '$SUPERVISOR_USER' already exists."
  run_quiet $SUDO usermod -g "$SUPERVISOR_GROUP" "$SUPERVISOR_USER"
fi

if ! getent group "$DIRECTOR_GROUP" >/dev/null 2>&1; then
  run_quiet $SUDO groupadd --system "$DIRECTOR_GROUP"
  DIRECTOR_GROUP_CREATED_BY_INSTALLER=1
else
  log "System group '$DIRECTOR_GROUP' already exists."
fi

# Step 12: Publish the Ehecoatl CLI command.
step 12 "Publishing CLI command"
run_quiet $SUDO chmod +x "$CLI_BASE_DIR/ehecoatl.sh"
while IFS= read -r cli_script; do
  [ -n "$cli_script" ] || continue
  run_quiet $SUDO chmod +x "$cli_script"
done < <(find "$CLI_BASE_DIR/commands" -type f -name '*.sh' | sort)
run_quiet $SUDO ln -sfn "$CLI_BASE_DIR/ehecoatl.sh" "$CLI_TARGET"

# Step 13: Create the standard runtime directories.
step 13 "Creating contract-defined system topology"
materialize_contract_topology
log "Writing split JSON configuration"
write_split_json_config

# Step 14: Apply ownership and permissions.
step 14 "Setting permissions"
materialize_contract_topology

# Step 15: Materialize root-only administrative symlinks.
step 15 "Materializing root helper symlinks"
materialize_contract_symlinks

# Step 16: Grant runtime users access to the installed runtime tree.
step 16 "Granting installed runtime access"
grant_project_runtime_access

# Step 17: Install nginx welcome page when available.
step 17 "Installing welcome page when nginx is available"
install_welcome_page_if_nginx_available

# Step 18: Install the runtime service.
step 18 "Installing runtime service"
install_systemd_service

# Step 19: Write installation metadata and registry.
step 19 "Writing installation metadata"
write_install_metadata
write_install_registry

# Step 20: Verify the final setup state.
step 20 "Verifying setup state"
verify_setup_state

# Step 21: Optionally scaffold the first tenant.
step 21 "Optional first tenant scaffold"
prompt_and_create_first_tenant

# Step 22: Finish the setup flow.
step 22 "Finishing"
log "Ehecoatl installed successfully."
log "Use 'ehecoatl core start' to launch manually when needed."
log "Use setup/bootstraps/bootstrap-nginx.sh only when you want Ehecoatl to manage a local Nginx installation."
log "Use setup/bootstraps/bootstrap-lets-encrypt.sh only when you want Ehecoatl to manage a local Let's Encrypt client installation."
log "Use setup/bootstraps/bootstrap-redis.sh only when you want Ehecoatl to manage a local Redis ${EHECOATL_REDIS_SUPPORTED_MAJOR:-7}.x installation."
