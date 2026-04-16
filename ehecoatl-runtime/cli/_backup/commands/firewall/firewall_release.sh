#!/bin/bash
set -euo pipefail

USER_NAME="${1:-}"
PROCESS_LABEL="${2:-unknown}"
INPUT_CHAIN="${3:-}"

if [ -z "$USER_NAME" ]; then
  echo "Usage: ehecoatl firewall_release <user> [process-label] [input-chain]"
  exit 1
fi

resolve_input_chain() {
  local user_name="$1"
  local process_label="$2"
  local sanitized_user legacy_chain fingerprint

  sanitized_user="$(printf '%s' "$user_name" | tr '[:lower:].-' '[:upper:]__' | tr -cd 'A-Z0-9_')"
  [ -n "$sanitized_user" ] || sanitized_user="UNKNOWN"
  legacy_chain="EHECOATL_FW_INPUT_${sanitized_user}"

  if [ "${#legacy_chain}" -le 28 ]; then
    printf '%s\n' "$legacy_chain"
    return 0
  fi

  fingerprint="$(printf '%s' "${user_name}:${process_label}" | sha1sum | cut -c1-10 | tr '[:lower:]' '[:upper:]')"
  printf 'EHECOATL_FW_I_%s\n' "$fingerprint"
}

if [ -z "$INPUT_CHAIN" ]; then
  INPUT_CHAIN="$(resolve_input_chain "$USER_NAME" "$PROCESS_LABEL")"
fi

log() {
  printf '[FIREWALL_RELEASE] %s\n' "$1"
}

run_rule() {
  "$@" >/dev/null 2>&1 || true
}

log "Releasing inbound firewall rules for user '$USER_NAME' label '$PROCESS_LABEL'"

run_rule sudo iptables -t filter -D INPUT -p tcp -j "$INPUT_CHAIN"
run_rule sudo iptables -t filter -F "$INPUT_CHAIN"
run_rule sudo iptables -t filter -X "$INPUT_CHAIN"

log "Inbound rules removed successfully."
