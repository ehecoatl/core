#!/bin/bash
set -euo pipefail

# Downloader flow:
# 1. Resolve the owning user home and the download root under ~/ehecoatl.
# 2. Install git and TLS prerequisites when needed.
# 3. Resolve the requested ref or the latest downloadable release/commit.
# 4. Reuse an existing downloaded checkout when that version is already present.
# 5. Download the selected version into ~/ehecoatl/<tag-or-commit>.

REPO_URL="${EHECOATL_REPO_URL:-https://github.com/braxismedia/ehecoatl.git}"
REQUESTED_REF=""
DOWNLOAD_OWNER=""
DOWNLOAD_GROUP=""
DOWNLOAD_OWNER_HOME=""
DOWNLOAD_BASE_DIR=""
RESOLVED_REF_NAME=""
RESOLVED_REF_KIND=""
RESOLVED_COMMIT=""
CHECKOUT_SPEC=""
TARGET_DIR=""
NON_INTERACTIVE=0
AUTO_INSTALLER=0
DRY_RUN=0
CURRENT_STEP=""

if [ -t 1 ]; then
  LOG_PREFIX_STYLE=$'\033[30m\033[43m \033[1m'
  LOG_RESET_STYLE=$'\033[22m \033[0m'
else
  LOG_PREFIX_STYLE=''
  LOG_RESET_STYLE=''
fi

log() {
  printf '%s[EHECOATL DOWNLOADER]%s %s\n' "$LOG_PREFIX_STYLE" "$LOG_RESET_STYLE" "$1"
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
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] $*"
    return 0
  fi
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

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --non-interactive|--nointeraction)
        NON_INTERACTIVE=1
        ;;
      --dry-run)
        DRY_RUN=1
        NON_INTERACTIVE=1
        ;;
      --auto-installer)
        AUTO_INSTALLER=1
        ;;
      --ref)
        shift
        [ $# -gt 0 ] || fail "Missing value for --ref"
        REQUESTED_REF="$1"
        ;;
      *)
        fail "Unknown option: $1"
        ;;
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
    fail "downloader-ehecoatl.sh must be run as root or invoked via sudo."
  fi
  fail "downloader-ehecoatl.sh must be run as root. sudo is not available on this host."
}

SUDO=""

require_command() {
  command -v "$1" >/dev/null 2>&1
}

package_is_installed() {
  local package_name="$1"

  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q 'install ok installed'
    return $?
  fi

  if command -v rpm >/dev/null 2>&1; then
    rpm -q "$package_name" >/dev/null 2>&1
    return $?
  fi

  return 1
}

append_managed_package() {
  local package_name="$1"
  local existing_package

  [ -n "$package_name" ] || return 0

  for existing_package in "${INSTALLER_MANAGED_PACKAGES[@]:-}"; do
    [ "$existing_package" = "$package_name" ] && return 0
  done
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
}

install_git() {
  if require_command git; then
    return 0
  fi

  if require_command apt-get; then
    local preinstalled_git=0
    local preinstalled_ca_certificates=0
    package_is_installed git && preinstalled_git=1
    package_is_installed ca-certificates && preinstalled_ca_certificates=1
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates
    [ "$preinstalled_git" -eq 1 ] || append_managed_package git
    [ "$preinstalled_ca_certificates" -eq 1 ] || append_managed_package ca-certificates
    return 0
  fi

  if require_command dnf; then
    local preinstalled_git=0
    local preinstalled_ca_certificates=0
    package_is_installed git && preinstalled_git=1
    package_is_installed ca-certificates && preinstalled_ca_certificates=1
    run_quiet $SUDO dnf install -y git ca-certificates
    [ "$preinstalled_git" -eq 1 ] || append_managed_package git
    [ "$preinstalled_ca_certificates" -eq 1 ] || append_managed_package ca-certificates
    return 0
  fi

  fail "git is required and could not be installed automatically."
}

print_dry_run_summary() {
  log "Dry run summary:"
  log "  - Repository URL: $REPO_URL"
  log "  - Download root: $DOWNLOAD_BASE_DIR"
  if [ -n "$REQUESTED_REF" ]; then
    log "  - Requested ref: $REQUESTED_REF"
  else
    log "  - Requested ref: latest downloadable release or commit"
  fi
  log "What may be installed:"
  if ! require_command git; then
    log "  - git"
    log "  - ca-certificates"
  fi
  log "What will be changed:"
  log "  - Resolve the downloadable ref from $REPO_URL"
  log "  - Download the selected checkout into $DOWNLOAD_BASE_DIR/<tag-or-commit>"
  log "  - Preserve downloaded checkouts as manual cache under $DOWNLOAD_BASE_DIR"
  if [ "$AUTO_INSTALLER" -eq 1 ]; then
    log "  - After download, invoke bootstrap-ehecoatl.sh with --auto-installer"
    log "    so bootstrap can continue into setup-ehecoatl.sh"
  fi
}

prepare_download_base_dir() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] mkdir -p $DOWNLOAD_BASE_DIR"
    log "[dry-run] chown $DOWNLOAD_OWNER:$DOWNLOAD_GROUP $DOWNLOAD_BASE_DIR"
    return 0
  fi
  run_quiet $SUDO mkdir -p "$DOWNLOAD_BASE_DIR"
  run_quiet $SUDO chown "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$DOWNLOAD_BASE_DIR"
}

resolve_ref() {
  local tmp_repo latest_tag default_branch
  tmp_repo="$(mktemp -d)"
  trap 'rm -rf "${tmp_repo:-}"; fail "Command failed on line $LINENO."' ERR

  run_quiet git init -q "$tmp_repo"
  run_quiet git -C "$tmp_repo" remote add origin "$REPO_URL"
  run_quiet git -C "$tmp_repo" fetch --tags --force origin '+refs/heads/*:refs/remotes/origin/*'

  if [ -n "$REQUESTED_REF" ]; then
    if git -C "$tmp_repo" rev-parse -q --verify "refs/tags/$REQUESTED_REF^{commit}" >/dev/null 2>&1; then
      RESOLVED_REF_KIND="tag"
      RESOLVED_REF_NAME="$REQUESTED_REF"
      CHECKOUT_SPEC="tags/$REQUESTED_REF"
      RESOLVED_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/tags/$REQUESTED_REF^{commit}")"
    elif git -C "$tmp_repo" rev-parse -q --verify "refs/remotes/origin/$REQUESTED_REF^{commit}" >/dev/null 2>&1; then
      RESOLVED_REF_KIND="branch"
      CHECKOUT_SPEC="origin/$REQUESTED_REF"
      RESOLVED_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/remotes/origin/$REQUESTED_REF^{commit}")"
      RESOLVED_REF_NAME="$RESOLVED_COMMIT"
    else
      if ! run_quiet git -C "$tmp_repo" fetch --depth 1 origin "$REQUESTED_REF"; then
        fail "Could not resolve requested ref: $REQUESTED_REF"
      fi
      RESOLVED_REF_KIND="commit"
      CHECKOUT_SPEC="FETCH_HEAD"
      RESOLVED_COMMIT="$(git -C "$tmp_repo" rev-parse "FETCH_HEAD^{commit}")"
      RESOLVED_REF_NAME="$RESOLVED_COMMIT"
    fi
  else
    latest_tag="$(git -C "$tmp_repo" for-each-ref --sort=-creatordate --format='%(refname:strip=2)' refs/tags | head -n 1)"
    if [ -n "$latest_tag" ]; then
      RESOLVED_REF_KIND="tag"
      RESOLVED_REF_NAME="$latest_tag"
      CHECKOUT_SPEC="tags/$latest_tag"
      RESOLVED_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/tags/$latest_tag^{commit}")"
    else
      default_branch="$(git -C "$tmp_repo" remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p' | head -n 1)"
      default_branch="${default_branch:-main}"
      RESOLVED_REF_KIND="commit"
      CHECKOUT_SPEC="origin/$default_branch"
      RESOLVED_COMMIT="$(git -C "$tmp_repo" rev-parse "refs/remotes/origin/$default_branch^{commit}")"
      RESOLVED_REF_NAME="$RESOLVED_COMMIT"
    fi
  fi

  TARGET_DIR="${DOWNLOAD_BASE_DIR}/${RESOLVED_REF_NAME}"

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$RESOLVED_REF_KIND" = "tag" ]; then
      log "Resolved download target: tag $RESOLVED_REF_NAME"
    else
      log "Resolved download target: commit $RESOLVED_COMMIT"
    fi
    rm -rf "$tmp_repo"
    trap 'fail "Command failed on line $LINENO."' ERR
    return 0
  fi

  if [ -d "$TARGET_DIR/ehecoatl-runtime" ] && [ -d "$TARGET_DIR/setup" ]; then
    log "Version already downloaded: $RESOLVED_REF_NAME"
    log "Location: $TARGET_DIR"
    log "Downloaded checkouts are preserved as manual cache until you remove them yourself."
    rm -rf "$tmp_repo"
    trap 'fail "Command failed on line $LINENO."' ERR
    exit 0
  fi

  if [ -e "$TARGET_DIR" ]; then
    fail "Target path already exists but is not a valid Ehecoatl checkout: $TARGET_DIR"
  fi

  log "Downloading ${RESOLVED_REF_KIND} ${RESOLVED_REF_NAME}"
  run_quiet git -C "$tmp_repo" checkout -q "$CHECKOUT_SPEC"
  [ -d "$tmp_repo/ehecoatl-runtime" ] || fail "ehecoatl-runtime payload not found in repository at $REPO_URL"
  [ -d "$tmp_repo/setup" ] || fail "setup folder not found in repository at $REPO_URL"
  run_quiet cp -a "$tmp_repo" "$TARGET_DIR"
  run_quiet $SUDO chown -R "$DOWNLOAD_OWNER:$DOWNLOAD_GROUP" "$TARGET_DIR"

  rm -rf "$tmp_repo"
  trap 'fail "Command failed on line $LINENO."' ERR
}

parse_args "$@"
require_root

step 1 "Resolving download root"
resolve_download_owner
[ -n "$DOWNLOAD_BASE_DIR" ] || fail "Download root directory is not defined."

if [ "$DRY_RUN" -eq 1 ]; then
  print_dry_run_summary
  if [ "$AUTO_INSTALLER" -eq 1 ]; then
    local_dry_run_command="[dry-run] bash $DOWNLOAD_BASE_DIR/<tag-or-commit>/setup/bootstrap-ehecoatl.sh --auto-installer --dry-run"
    if [ "$NON_INTERACTIVE" -eq 1 ]; then
      local_dry_run_command="$local_dry_run_command --non-interactive"
    fi
    log "$local_dry_run_command"
  fi
  exit 0
fi

step 2 "Checking git"
install_git

step 3 "Preparing download directory"
prepare_download_base_dir

step 4 "Resolving downloadable version"
resolve_ref

step 5 "Finishing"
log "Ehecoatl source checkout downloaded successfully."
log "Location: $TARGET_DIR"
log "Downloaded checkouts are preserved as manual cache until you remove them yourself."
if [ "$AUTO_INSTALLER" -eq 1 ]; then
  step 6 "Running auto-installer"
  bootstrap_args=()
  bootstrap_args+=("--auto-installer")
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    bootstrap_args+=("--non-interactive")
  fi
  log "Delegating install chain to bootstrap-ehecoatl.sh ${bootstrap_args[*]}"
  run_quiet bash "$TARGET_DIR/setup/bootstrap-ehecoatl.sh" "${bootstrap_args[@]}"
else
  log "Run $TARGET_DIR/setup/bootstrap-ehecoatl.sh to install the runtime payload into /opt/ehecoatl."
fi
