#!/bin/bash
set -euo pipefail

USER_NAME="${1:-}"

if [ -z "$USER_NAME" ]; then
  echo "Usage: ehecatl proxy_release <user>"
  exit 1
fi

CHAIN_SUFFIX="$(printf '%s' "$USER_NAME" | tr '[:lower:].-' '[:upper:]__' | tr -cd 'A-Z0-9_')"
FILTER_CHAIN="EHECATL_PROXY_FILTER_${CHAIN_SUFFIX}"
NAT_CHAIN="EHECATL_PROXY_NAT_${CHAIN_SUFFIX}"

log() {
  printf '[PROXY_RELEASE] %s\n' "$1"
}

run_rule() {
  "$@" >/dev/null 2>&1 || true
}

log "Releasing outbound proxy rules for user '$USER_NAME'"

run_rule sudo iptables -t filter -D OUTPUT -m owner --uid-owner "$USER_NAME" -j "$FILTER_CHAIN"
run_rule sudo iptables -t nat -D OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" --dport 443 -j "$NAT_CHAIN"

run_rule sudo iptables -t filter -F "$FILTER_CHAIN"
run_rule sudo iptables -t filter -X "$FILTER_CHAIN"
run_rule sudo iptables -t nat -F "$NAT_CHAIN"
run_rule sudo iptables -t nat -X "$NAT_CHAIN"

log "Rules removed successfully."
