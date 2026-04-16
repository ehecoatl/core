#!/bin/bash
set -euo pipefail

USER_NAME="${1:-}"
PROCESS_LABEL="${2:-unknown}"
INPUT_CHAIN="${3:-}"

if [ -z "$USER_NAME" ]; then
  echo "Usage: ehecatl firewall_setup <user> [process-label] [input-chain]"
  exit 1
fi

resolve_input_chain() {
  local user_name="$1"
  local process_label="$2"
  local sanitized_user legacy_chain fingerprint

  sanitized_user="$(printf '%s' "$user_name" | tr '[:lower:].-' '[:upper:]__' | tr -cd 'A-Z0-9_')"
  [ -n "$sanitized_user" ] || sanitized_user="UNKNOWN"
  legacy_chain="EHECATL_FW_INPUT_${sanitized_user}"

  if [ "${#legacy_chain}" -le 28 ]; then
    printf '%s\n' "$legacy_chain"
    return 0
  fi

  fingerprint="$(printf '%s' "${user_name}:${process_label}" | sha1sum | cut -c1-10 | tr '[:lower:]' '[:upper:]')"
  printf 'EHECATL_FW_I_%s\n' "$fingerprint"
}

if [ -z "$INPUT_CHAIN" ]; then
  INPUT_CHAIN="$(resolve_input_chain "$USER_NAME" "$PROCESS_LABEL")"
fi

log() {
  printf '[FIREWALL_SETUP] %s\n' "$1"
}

run_rule() {
  "$@" >/dev/null 2>&1 || true
}

extract_ports_for_user() {
  local user_name="$1"
  local ports=()
  local line local_addr proc_field pid owner port

  while IFS= read -r line; do
    local_addr="$(printf '%s' "$line" | awk '{print $4}')"
    proc_field="$(printf '%s' "$line" | awk '{print $NF}')"
    pid="$(printf '%s' "$proc_field" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)"
    [ -n "$pid" ] || continue

    owner="$(ps -o user= -p "$pid" 2>/dev/null | awk '{print $1}')"
    [ "$owner" = "$user_name" ] || continue

    port="${local_addr##*:}"
    [[ "$port" =~ ^[0-9]+$ ]] || continue
    ports+=("$port")
  done < <(sudo ss -H -ltnp 2>/dev/null || true)

  if [ "${#ports[@]}" -eq 0 ]; then
    return 0
  fi

  printf '%s\n' "${ports[@]}" | sort -u
}

log "Applying inbound firewall rules for user '$USER_NAME' label '$PROCESS_LABEL'"

run_rule sudo iptables -t filter -D INPUT -p tcp -j "$INPUT_CHAIN"
run_rule sudo iptables -t filter -F "$INPUT_CHAIN"
run_rule sudo iptables -t filter -X "$INPUT_CHAIN"

sudo iptables -t filter -N "$INPUT_CHAIN"

PORTS="$(extract_ports_for_user "$USER_NAME" || true)"
if [ -z "${PORTS:-}" ]; then
  log "No listening TCP ports detected for user '$USER_NAME'; chain created with no blocking rules."
else
  while IFS= read -r port; do
    [ -n "$port" ] || continue
    sudo iptables -t filter -A "$INPUT_CHAIN" -i lo -p tcp --dport "$port" -j RETURN
    sudo iptables -t filter -A "$INPUT_CHAIN" ! -i lo -p tcp --dport "$port" -j REJECT
  done <<< "$PORTS"
fi

sudo iptables -t filter -A "$INPUT_CHAIN" -j RETURN
sudo iptables -t filter -A INPUT -p tcp -j "$INPUT_CHAIN"

log "Inbound rules applied successfully."
