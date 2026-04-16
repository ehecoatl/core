#!/bin/bash
set -euo pipefail

# Bootstrap flow:
# 1. Configure logging, failure, and quiet command helpers.
# 2. Resolve whether sudo is needed.
# 3. Detect the available package manager and existing Redis installation.
# 4. Install Redis when it is not already available.
# 5. Detect the available Redis service unit.
# 6. Enable and start the Redis service when systemd is available.
# 7. Log successful Redis bootstrap completion.

REDIS_PACKAGE_NAME=""
REDIS_SERVICE_NAME=""
REDIS_MANAGED_BY_BOOTSTRAP=0
CURRENT_STEP=""

# Stage 1: helper functions for Redis bootstrap logging, failure handling, and quiet command execution.
log() {
  printf '[EHECATL BOOTSTRAP REDIS] %s\n' "$1"
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
  CURRENT_STEP="$1"
  log "$CURRENT_STEP"
}

trap 'fail "Command failed on line $LINENO."' ERR

# Stage 2: resolve whether privileged operations will use sudo.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to bootstrap Redis."
  SUDO="sudo"
fi

# Stage 3: command and package detection helpers.
require_command() {
  command -v "$1" >/dev/null 2>&1
}

package_is_installed() {
  local package_name="$1"

  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -q "install ok installed"
    return $?
  fi

  if command -v rpm >/dev/null 2>&1; then
    rpm -q "$package_name" >/dev/null 2>&1
    return $?
  fi

  return 1
}

detect_existing_redis() {
  if require_command redis-server; then
    if require_command apt-get; then
      REDIS_PACKAGE_NAME="redis-server"
    elif require_command dnf; then
      REDIS_PACKAGE_NAME="redis"
    fi
    return 0
  fi

  if require_command redis-cli; then
    if require_command apt-get; then
      REDIS_PACKAGE_NAME="redis-server"
    elif require_command dnf; then
      REDIS_PACKAGE_NAME="redis"
    fi
    return 0
  fi

  return 1
}

install_redis() {
  if detect_existing_redis; then
    return 0
  fi

  if require_command apt-get; then
    REDIS_PACKAGE_NAME="redis-server"
    run_quiet $SUDO apt-get update -qq
    run_quiet $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq redis-server
  elif require_command dnf; then
    REDIS_PACKAGE_NAME="redis"
    run_quiet $SUDO dnf install -y redis
  else
    fail "Redis could not be installed automatically on this system."
  fi

  require_command redis-server || fail "Redis installation completed, but the redis-server command is still unavailable."
  REDIS_MANAGED_BY_BOOTSTRAP=1
}

enable_redis_service() {
  if ! require_command systemctl; then
    log "systemd not detected; skipping Redis service enablement."
    return 0
  fi

  if systemctl list-unit-files redis-server.service >/dev/null 2>&1; then
    REDIS_SERVICE_NAME="redis-server"
    run_quiet $SUDO systemctl enable --now redis-server
    return 0
  fi

  if systemctl list-unit-files redis.service >/dev/null 2>&1; then
    REDIS_SERVICE_NAME="redis"
    run_quiet $SUDO systemctl enable --now redis
    return 0
  fi

  log "Redis was detected, but no redis.service or redis-server.service unit was found."
}

step "Checking for existing Redis installation"
install_redis

step "Configuring Redis service"
enable_redis_service

step "Finishing"
if [ "$REDIS_MANAGED_BY_BOOTSTRAP" -eq 1 ]; then
  log "Redis was installed and bootstrapped successfully."
else
  log "Existing Redis installation detected and prepared successfully."
fi
if [ -n "$REDIS_SERVICE_NAME" ]; then
  log "Active Redis service unit: $REDIS_SERVICE_NAME"
fi
