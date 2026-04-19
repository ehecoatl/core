#!/bin/bash
set -euo pipefail

REPO_URL="${EHECOATL_REPO_URL:-https://github.com/wolimp-inc/ehecoatl-core.git}"
INSTALL_DIR="/opt/ehecoatl"
INSTALL_META_FILE="/etc/opt/ehecoatl/install-meta.env"
MANAGER_VERSION="v1"
MANAGER_CANONICAL_NAME="ehecoatl-core.sh"
MANAGER_REEXEC_GUARD="${EHECOATL_CORE_MANAGER_REEXEC:-0}"
SCRIPT_NAME="$(basename "$0")"
SCRIPT_ARGS=("$@")

PRIMARY_COMMAND=""
REQUESTED_RELEASE=""
AUTO_INSTALL_AFTER_DOWNLOAD=0
DOWNLOAD_OWNER=""
DOWNLOAD_GROUP=""
DOWNLOAD_OWNER_HOME=""
DOWNLOAD_BASE_DIR=""
MANAGER_CANONICAL_PATH=""
CURRENT_STEP=""
SUDO=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() {
  printf '%s[EHECOATL CORE]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"
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

step() {
  local step_number="$1"
  shift
  CURRENT_STEP="[$step_number] $*"
  log "$CURRENT_STEP"
}

trap 'fail "Command failed on line $LINENO."' ERR

print_usage() {
  cat <<EOF_USAGE
Ehecoatl Core Manager $MANAGER_VERSION

Purpose:
  Standalone release manager for downloading, installing, inspecting, and
  uninstalling packaged Ehecoatl releases from local or cached checkouts.

Preferred command path:
  bash ~/ehecoatl/$MANAGER_CANONICAL_NAME <command>

Usage:
  sudo bash $SCRIPT_NAME --help
  sudo bash $SCRIPT_NAME --version
  sudo bash $SCRIPT_NAME --releases
  sudo bash $SCRIPT_NAME --installed-version
  sudo bash $SCRIPT_NAME --download <release>
  sudo bash $SCRIPT_NAME --download <release> --auto-install
  sudo bash $SCRIPT_NAME --install <release>
  sudo bash $SCRIPT_NAME --uninstall

Commands:
  --help, -h
    Show this manager overview, its version, and the active commands.

  --version, -v
    Show the manager version and canonical execution path.

  --releases, -r
    List available releases from the configured git repository.
    Marks cached downloads under ~/ehecoatl/<release> as [downloaded].
    Marks the active installed release as [installed].

  --installed-version, -i
    Show the installed release, commit, package version, install path,
    source checkout path, install timestamp, and install id.

  --download <release>, -d <release>
    Download one release into ~/ehecoatl/<release>.
    Add --auto-install to start installation immediately after download.

  --install <release>, -a <release>
    Install one release.
    Uses ~/ehecoatl/<release> when already downloaded, otherwise downloads it first.

  --uninstall
    Run the uninstall flow for the installed release.
    If the matching checkout is missing locally, it is downloaded first.

Notes:
  - Run mutating commands as root: sudo bash $SCRIPT_NAME ...
  - The canonical manager copy lives at ~/ehecoatl/$MANAGER_CANONICAL_NAME
  - Existing uninstall secure confirmation remains interactive by default.

Examples:
  sudo bash $SCRIPT_NAME --releases
  sudo bash $SCRIPT_NAME --download v1.0.0
  sudo bash $SCRIPT_NAME --download v1.0.0 --auto-install
  sudo bash $SCRIPT_NAME --install v1.0.0
  sudo bash $SCRIPT_NAME --installed-version
  sudo bash $SCRIPT_NAME --uninstall
EOF_USAGE
}

print_manager_version() {
  printf 'Manager version: %s\n' "$MANAGER_VERSION"
  printf 'Current script: %s\n' "$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  if [ -n "$MANAGER_CANONICAL_PATH" ]; then
    printf 'Preferred path: %s\n' "$MANAGER_CANONICAL_PATH"
  else
    printf 'Preferred path: %s\n' "~/ehecoatl/$MANAGER_CANONICAL_NAME"
  fi
}

set_primary_command() {
  local candidate="$1"
  if [ -n "$PRIMARY_COMMAND" ] && [ "$PRIMARY_COMMAND" != "$candidate" ]; then
    fail "Only one primary command is allowed per invocation."
  fi
  PRIMARY_COMMAND="$candidate"
}

parse_args() {
  local option_name=""

  if [ $# -eq 0 ]; then
    return 0
  fi

  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h)
        PRIMARY_COMMAND="help"
        ;;
      --releases|-r)
        set_primary_command "releases"
        ;;
      --installed-version|-i|--installed)
        set_primary_command "installed-version"
        ;;
      --version|-v)
        set_primary_command "manager-version"
        ;;
      --download|-d)
        option_name="$1"
        set_primary_command "download"
        shift
        [ $# -gt 0 ] || fail "Missing value for $option_name"
        case "$1" in
          --*)
            fail "Missing release name for download command"
            ;;
        esac
        REQUESTED_RELEASE="$1"
        ;;
      --install|-a)
        option_name="$1"
        set_primary_command "install"
        shift
        [ $# -gt 0 ] || fail "Missing value for $option_name"
        case "$1" in
          --*)
            fail "Missing release name for install command"
            ;;
        esac
        REQUESTED_RELEASE="$1"
        ;;
      --auto-install)
        [ "$PRIMARY_COMMAND" = "download" ] || fail "--auto-install is only valid together with --download <release>."
        AUTO_INSTALL_AFTER_DOWNLOAD=1
        ;;
      --uninstall)
        set_primary_command "uninstall"
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done

  case "$PRIMARY_COMMAND" in
    ""|help|releases|installed-version|manager-version|uninstall)
      [ -z "$REQUESTED_RELEASE" ] || fail "Unexpected release value for $PRIMARY_COMMAND."
      ;;
    download)
      [ -n "$REQUESTED_RELEASE" ] || fail "Missing release value for --download."
      ;;
    install)
      [ -n "$REQUESTED_RELEASE" ] || fail "Missing release value for --install."
      ;;
    *)
      fail "Unsupported command parser state: $PRIMARY_COMMAND"
      ;;
  esac
}

require_root() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    [ "${EHECOATL_SETUP_SUDO_REEXEC:-0}" = "1" ] && fail "$SCRIPT_NAME could not acquire root privileges through sudo."
    exec sudo \
      EHECOATL_SETUP_SUDO_REEXEC=1 \
      EHECOATL_REPO_URL="$REPO_URL" \
      EHECOATL_CORE_MANAGER_REEXEC="$MANAGER_REEXEC_GUARD" \
      bash "$0" "${SCRIPT_ARGS[@]}"
  fi
  fail "$SCRIPT_NAME must be run as root. sudo is not available on this host."
}

require_command() {
  command -v "$1" >/dev/null 2>&1
}

install_missing_packages() {
  [ $# -gt 0 ] || return 0

  if require_command apt-get; then
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
    return 0
  fi

  if require_command dnf; then
    run_quiet $SUDO dnf install -y "$@"
    return 0
  fi

  fail "Required packages are missing and could not be installed automatically: $*"
}

ensure_git() {
  require_command git && return 0
  install_missing_packages git ca-certificates
  require_command git || fail "git is required but still unavailable after installation."
}

ensure_curl() {
  require_command curl && return 0
  install_missing_packages curl ca-certificates
  require_command curl || fail "curl is required but still unavailable after installation."
}

resolve_download_owner() {
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    DOWNLOAD_OWNER="$SUDO_USER"
  else
    DOWNLOAD_OWNER="$(id -un)"
  fi

  DOWNLOAD_GROUP="$(id -gn "$DOWNLOAD_OWNER")"
  DOWNLOAD_OWNER_HOME="$(getent passwd "$DOWNLOAD_OWNER" | cut -d: -f6)"
  [ -n "$DOWNLOAD_OWNER_HOME" ] || fail "Could not resolve home directory for $DOWNLOAD_OWNER"
  DOWNLOAD_BASE_DIR="${DOWNLOAD_OWNER_HOME}/ehecoatl"
  MANAGER_CANONICAL_PATH="${DOWNLOAD_BASE_DIR}/${MANAGER_CANONICAL_NAME}"
}

prepare_download_base_dir() {
  run_quiet mkdir -p "$DOWNLOAD_BASE_DIR"
  run_quiet chmod 2775 "$DOWNLOAD_BASE_DIR"
  if [ "$(id -u)" -eq 0 ]; then
    run_quiet chown "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$DOWNLOAD_BASE_DIR"
  fi
}

manager_version_number() {
  case "$1" in
    v[0-9]*)
      printf '%s\n' "${1#v}"
      ;;
    *)
      return 1
      ;;
  esac
}

read_script_manager_version() {
  local script_path="$1"
  [ -f "$script_path" ] || return 1
  sed -n 's/^MANAGER_VERSION="\([^"]*\)"$/\1/p' "$script_path" | head -n 1
}

sync_manager_canonical_copy() {
  local current_script_path current_script_version home_script_version current_version_number home_version_number

  current_script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  current_script_version="$MANAGER_VERSION"

  if [ ! -f "$MANAGER_CANONICAL_PATH" ]; then
    run_quiet cp "$current_script_path" "$MANAGER_CANONICAL_PATH"
    run_quiet chmod 0775 "$MANAGER_CANONICAL_PATH"
    if [ "$(id -u)" -eq 0 ]; then
      run_quiet chown "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$MANAGER_CANONICAL_PATH"
    fi
    log "Installed the canonical manager copy at $MANAGER_CANONICAL_PATH."
    log "Preferred command path: bash $MANAGER_CANONICAL_PATH ..."
    return 0
  fi

  if [ "$current_script_path" = "$MANAGER_CANONICAL_PATH" ]; then
    return 0
  fi

  home_script_version="$(read_script_manager_version "$MANAGER_CANONICAL_PATH" || true)"
  [ -n "$home_script_version" ] || fail "Could not read manager version from $MANAGER_CANONICAL_PATH"

  current_version_number="$(manager_version_number "$current_script_version" || true)"
  home_version_number="$(manager_version_number "$home_script_version" || true)"
  [ -n "$current_version_number" ] || fail "Unsupported current manager version format: $current_script_version"
  [ -n "$home_version_number" ] || fail "Unsupported canonical manager version format: $home_script_version"

  if [ "$home_version_number" -gt "$current_version_number" ]; then
    if [ "$MANAGER_REEXEC_GUARD" = "1" ]; then
      log "Detected a newer canonical manager at $MANAGER_CANONICAL_PATH, but re-exec is already active. Continuing with the current process."
      return 0
    fi
    log "Detected newer canonical manager $home_script_version at $MANAGER_CANONICAL_PATH. Current script is $current_script_version."
    log "Preferred command path: bash $MANAGER_CANONICAL_PATH ..."
    exec env \
      EHECOATL_CORE_MANAGER_REEXEC=1 \
      EHECOATL_REPO_URL="$REPO_URL" \
      bash "$MANAGER_CANONICAL_PATH" "${SCRIPT_ARGS[@]}"
  fi

  if [ "$home_version_number" -lt "$current_version_number" ]; then
    run_quiet cp "$current_script_path" "$MANAGER_CANONICAL_PATH"
    run_quiet chmod 0775 "$MANAGER_CANONICAL_PATH"
    if [ "$(id -u)" -eq 0 ]; then
      run_quiet chown "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$MANAGER_CANONICAL_PATH"
    fi
    log "Updated canonical manager copy at $MANAGER_CANONICAL_PATH from $home_script_version to $current_script_version."
    log "Preferred command path: bash $MANAGER_CANONICAL_PATH ..."
  fi
}

valid_checkout_dir() {
  local candidate_dir="$1"
  [ -d "$candidate_dir/ehecoatl-runtime" ] && [ -d "$candidate_dir/setup" ]
}

github_repo_slug() {
  local normalized slug
  normalized="${REPO_URL%.git}"

  case "$normalized" in
    https://github.com/*|http://github.com/*)
      slug="${normalized#*://github.com/}"
      ;;
    git@github.com:*)
      slug="${normalized#git@github.com:}"
      ;;
    ssh://git@github.com/*)
      slug="${normalized#ssh://git@github.com/}"
      ;;
    *)
      return 1
      ;;
  esac

  case "$slug" in
    */*)
      printf '%s\n' "$slug"
      ;;
    *)
      return 1
      ;;
  esac
}

repo_uses_github_releases() {
  github_repo_slug >/dev/null 2>&1
}

list_github_releases() {
  local slug api_url response
  slug="$(github_repo_slug)" || return 1
  api_url="https://api.github.com/repos/${slug}/releases?per_page=100"
  response="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api_url")" || return 1
  printf '%s' "$response" \
    | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed 's/^.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/' \
    | awk '!seen[$0]++'
}

list_remote_tags() {
  git ls-remote --tags --refs "$REPO_URL" \
    | awk '{print $2}' \
    | sed 's#^refs/tags/##' \
    | sort -rV
}

read_install_metadata_value() {
  local key_name="$1"
  [ -f "$INSTALL_META_FILE" ] || return 1
  sed -n "s/^${key_name}=\"\(.*\)\"$/\1/p" "$INSTALL_META_FILE" | head -n 1
}

load_install_metadata() {
  SOURCE_RELEASE=""
  SOURCE_COMMIT=""
  SOURCE_CHECKOUT_DIR=""
  INSTALLED_AT_UTC=""
  PROJECT_DIR=""
  INSTALL_ID=""
  CLI_TARGET=""

  [ -f "$INSTALL_META_FILE" ] || return 1

  SOURCE_RELEASE="$(read_install_metadata_value SOURCE_RELEASE || true)"
  SOURCE_COMMIT="$(read_install_metadata_value SOURCE_COMMIT || true)"
  SOURCE_CHECKOUT_DIR="$(read_install_metadata_value SOURCE_CHECKOUT_DIR || true)"
  INSTALLED_AT_UTC="$(read_install_metadata_value INSTALLED_AT_UTC || true)"
  PROJECT_DIR="$(read_install_metadata_value PROJECT_DIR || true)"
  INSTALL_ID="$(read_install_metadata_value INSTALL_ID || true)"
  CLI_TARGET="$(read_install_metadata_value CLI_TARGET || true)"
  return 0
}

has_existing_installation() {
  load_install_metadata || return 1
  local effective_project_dir
  effective_project_dir="${PROJECT_DIR:-$INSTALL_DIR}"
  [ -f "$effective_project_dir/package.json" ] || return 1
  return 0
}

read_package_version() {
  local package_json="$1"
  [ -f "$package_json" ] || return 1

  if require_command node; then
    node -p "require(process.argv[1]).version" "$package_json" 2>/dev/null
    return $?
  fi

  sed -n 's/^  "version": "\([^"]*\)",\?$/\1/p' "$package_json" | head -n 1
}

print_installed_version() {
  local effective_project_dir package_version
  if ! load_install_metadata && [ ! -f "$INSTALL_DIR/package.json" ]; then
    log "Ehecoatl is not installed."
    return 0
  fi

  effective_project_dir="${PROJECT_DIR:-$INSTALL_DIR}"
  package_version="$(read_package_version "$effective_project_dir/package.json" || true)"
  package_version="${package_version:-unknown}"

  printf 'Installed release: %s\n' "${SOURCE_RELEASE:-unknown}"
  printf 'Installed commit: %s\n' "${SOURCE_COMMIT:-unknown}"
  printf 'Package version: %s\n' "$package_version"
  printf 'Install path: %s\n' "${effective_project_dir:-$INSTALL_DIR}"
  printf 'Source checkout: %s\n' "${SOURCE_CHECKOUT_DIR:-unknown}"
  printf 'Installed at (UTC): %s\n' "${INSTALLED_AT_UTC:-unknown}"
  printf 'Install id: %s\n' "${INSTALL_ID:-unknown}"
}

print_manual_uninstall_guidance() {
  log "Manual uninstall is required before install can continue."

  if load_install_metadata && [ -n "${SOURCE_CHECKOUT_DIR:-}" ]; then
    if valid_checkout_dir "$SOURCE_CHECKOUT_DIR" && [ -f "$SOURCE_CHECKOUT_DIR/setup/uninstall.sh" ]; then
      log "Run: sudo bash $SOURCE_CHECKOUT_DIR/setup/uninstall.sh"
      log "After uninstall finishes, rerun the install command."
      return 0
    fi

    log "Installed metadata points to a source checkout that is not available locally: $SOURCE_CHECKOUT_DIR"
  fi

  log "Locate the source checkout that matches the currently installed runtime and run:"
  log "  sudo bash <checkout>/setup/uninstall.sh"
  log "After uninstall finishes, rerun the install command."
}

resolve_checkout_commit() {
  local checkout_dir="$1"
  [ -d "$checkout_dir/.git" ] || return 1
  git -C "$checkout_dir" rev-parse HEAD
}

resolve_requested_release_checkout() {
  local tmp_repo="$1"
  local requested_release="$2"

  if git -C "$tmp_repo" rev-parse -q --verify "refs/tags/$requested_release^{commit}" >/dev/null 2>&1; then
    RESOLVED_RELEASE_KIND="tag"
    RESOLVED_RELEASE_NAME="$requested_release"
    RESOLVED_CHECKOUT_SPEC="tags/$requested_release"
    RESOLVED_RELEASE_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/tags/$requested_release^{commit}")"
    return 0
  fi

  if git -C "$tmp_repo" rev-parse -q --verify "refs/remotes/origin/$requested_release^{commit}" >/dev/null 2>&1; then
    RESOLVED_RELEASE_KIND="branch"
    RESOLVED_RELEASE_NAME="$requested_release"
    RESOLVED_CHECKOUT_SPEC="origin/$requested_release"
    RESOLVED_RELEASE_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/remotes/origin/$requested_release^{commit}")"
    return 0
  fi

  if git -C "$tmp_repo" fetch --depth 1 origin "$requested_release" >/dev/null 2>&1; then
    RESOLVED_RELEASE_KIND="commit"
    RESOLVED_RELEASE_NAME="$requested_release"
    RESOLVED_CHECKOUT_SPEC="FETCH_HEAD"
    RESOLVED_RELEASE_COMMIT="$(git -C "$tmp_repo" rev-parse "FETCH_HEAD^{commit}")"
    return 0
  fi

  fail "Could not resolve requested release or ref: $requested_release"
}

download_release() {
  local requested_release="$1"
  local target_dir tmp_repo

  target_dir="${DOWNLOAD_BASE_DIR}/${requested_release}"

  if valid_checkout_dir "$target_dir"; then
    log "Release $requested_release is already downloaded at $target_dir"
    DOWNLOADED_TARGET_DIR="$target_dir"
    DOWNLOADED_RELEASE_COMMIT="$(resolve_checkout_commit "$target_dir" || true)"
    return 0
  fi

  if [ -e "$target_dir" ]; then
    fail "Target path already exists but is not a valid Ehecoatl checkout: $target_dir"
  fi

  tmp_repo="$(mktemp -d)"
  run_quiet git init -q "$tmp_repo"
  run_quiet git -C "$tmp_repo" remote add origin "$REPO_URL"
  run_quiet git -C "$tmp_repo" fetch --tags --force origin '+refs/heads/*:refs/remotes/origin/*'

  resolve_requested_release_checkout "$tmp_repo" "$requested_release"

  log "Downloading ${RESOLVED_RELEASE_KIND} ${RESOLVED_RELEASE_NAME}"
  run_quiet git -C "$tmp_repo" checkout -q "$RESOLVED_CHECKOUT_SPEC"
  [ -d "$tmp_repo/ehecoatl-runtime" ] || fail "ehecoatl-runtime payload not found in repository at $REPO_URL"
  [ -d "$tmp_repo/setup" ] || fail "setup folder not found in repository at $REPO_URL"
  run_quiet cp -a "$tmp_repo" "$target_dir"
  run_quiet chown -R "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$target_dir"
  rm -rf "$tmp_repo"

  DOWNLOADED_TARGET_DIR="$target_dir"
  DOWNLOADED_RELEASE_COMMIT="${RESOLVED_RELEASE_COMMIT:-}"
  log "Downloaded release $requested_release to $target_dir"
}

ensure_release_checkout() {
  local release_name="$1"
  local target_dir

  target_dir="${DOWNLOAD_BASE_DIR}/${release_name}"
  if valid_checkout_dir "$target_dir"; then
    DOWNLOADED_TARGET_DIR="$target_dir"
    DOWNLOADED_RELEASE_COMMIT="$(resolve_checkout_commit "$target_dir" || true)"
    return 0
  fi

  download_release "$release_name"
}

run_install_for_release() {
  local release_name="$1"
  local checkout_dir="$2"
  local release_commit="$3"
  local installed_at_utc bootstrap_script

  bootstrap_script="$checkout_dir/setup/bootstrap.sh"
  [ -f "$bootstrap_script" ] || fail "Bootstrap script not found at $bootstrap_script"

  installed_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  release_commit="${release_commit:-$(resolve_checkout_commit "$checkout_dir" || true)}"

  step 5 "Running bootstrap auto-install"
  log "Installing release $release_name from $checkout_dir"
  run_quiet env \
    EHECOATL_SOURCE_RELEASE="$release_name" \
    EHECOATL_SOURCE_COMMIT="${release_commit:-}" \
    EHECOATL_SOURCE_CHECKOUT_DIR="$checkout_dir" \
    EHECOATL_INSTALLED_AT_UTC="$installed_at_utc" \
    bash "$bootstrap_script" --auto-install --yes --non-interactive
}

run_uninstall_for_installed_release() {
  local installed_release checkout_dir uninstall_script

  if ! load_install_metadata; then
    log "Ehecoatl is not installed."
    return 0
  fi

  installed_release="${SOURCE_RELEASE:-}"
  [ -n "$installed_release" ] || fail "Installed metadata is missing SOURCE_RELEASE. Refusing uninstall without an exact release match."

  step 3 "Ensuring installed release checkout is available"
  ensure_git
  ensure_release_checkout "$installed_release"
  checkout_dir="$DOWNLOADED_TARGET_DIR"
  uninstall_script="$checkout_dir/setup/uninstall.sh"
  [ -f "$uninstall_script" ] || fail "Uninstall script not found at $uninstall_script"

  step 4 "Running installed release uninstall"
  log "Uninstalling installed release $installed_release using $uninstall_script"
  exec bash "$uninstall_script"
}

list_releases_with_status() {
  local releases_output release annotations found_installed=0

  if repo_uses_github_releases; then
    ensure_curl
    releases_output="$(list_github_releases || true)"
    if [ -z "$releases_output" ]; then
      log "No GitHub releases were returned; falling back to remote tags."
      ensure_git
      releases_output="$(list_remote_tags || true)"
    fi
  else
    ensure_git
    releases_output="$(list_remote_tags || true)"
  fi

  if [ -z "$releases_output" ]; then
    log "No releases were found for $REPO_URL"
    return 0
  fi

  load_install_metadata || true

  while IFS= read -r release; do
    [ -n "$release" ] || continue
    annotations=""
    if valid_checkout_dir "$DOWNLOAD_BASE_DIR/$release"; then
      annotations="$annotations [downloaded]"
    fi
    if [ "${SOURCE_RELEASE:-}" = "$release" ]; then
      annotations="$annotations [installed]"
      found_installed=1
    fi
    printf '%s%s\n' "$release" "$annotations"
  done <<EOF_RELEASES
$releases_output
EOF_RELEASES

  if [ -n "${SOURCE_RELEASE:-}" ] && [ "$found_installed" -eq 0 ]; then
    log "Installed release ${SOURCE_RELEASE} is not present in the current release list."
  fi
}

main() {
  parse_args "$@"

  resolve_download_owner
  prepare_download_base_dir
  sync_manager_canonical_copy

  if [ $# -eq 0 ] || [ -z "$PRIMARY_COMMAND" ] || [ "$PRIMARY_COMMAND" = "help" ]; then
    print_usage
    exit 0
  fi

  case "$PRIMARY_COMMAND" in
    manager-version)
      print_manager_version
      exit 0
      ;;
    releases|installed-version)
      ;;
    download|install|uninstall)
      require_root
      ;;
    *)
      fail "Unsupported primary command: $PRIMARY_COMMAND"
      ;;
  esac

  SUDO=""

  step 1 "Resolving download cache owner"
  log "Using release cache at $DOWNLOAD_BASE_DIR"

  case "$PRIMARY_COMMAND" in
    releases)
      step 2 "Listing available releases"
      list_releases_with_status
      ;;
    installed-version)
      step 2 "Reading installed release metadata"
      print_installed_version
      ;;
    download)
      step 2 "Checking download prerequisites"
      ensure_git
      step 3 "Downloading requested release"
      download_release "$REQUESTED_RELEASE"
      if [ "$AUTO_INSTALL_AFTER_DOWNLOAD" -eq 0 ]; then
        log "Run: sudo bash $MANAGER_CANONICAL_PATH --install $REQUESTED_RELEASE"
        exit 0
      fi

      if has_existing_installation; then
        log "An Ehecoatl installation is already present."
        print_manual_uninstall_guidance
        exit 1
      fi

      run_install_for_release "$REQUESTED_RELEASE" "$DOWNLOADED_TARGET_DIR" "${DOWNLOADED_RELEASE_COMMIT:-}"
      ;;
    install)
      step 2 "Ensuring requested release checkout is available"
      ensure_git
      ensure_release_checkout "$REQUESTED_RELEASE"

      if has_existing_installation; then
        log "An Ehecoatl installation is already present."
        print_manual_uninstall_guidance
        exit 1
      fi

      run_install_for_release "$REQUESTED_RELEASE" "$DOWNLOADED_TARGET_DIR" "${DOWNLOADED_RELEASE_COMMIT:-}"
      ;;
    uninstall)
      step 2 "Reading installed release metadata"
      run_uninstall_for_installed_release
      ;;
    *)
      fail "Unsupported primary command: $PRIMARY_COMMAND"
      ;;
  esac
}

main "$@"
