#!/bin/bash
set -euo pipefail

log() {
  printf '[PROXY_RELEASE_ALL] %s\n' "$1"
}

run_rule() {
  "$@" >/dev/null 2>&1 || true
}

cleanup_table_chains() {
  local table="$1"
  local prefix="$2"
  local chains chain

  chains="$(sudo iptables -t "$table" -S 2>/dev/null | awk -v prefix="$prefix" '$1 == "-N" && index($2, prefix) == 1 { print $2 }')"

  if [ -z "$chains" ]; then
    return 0
  fi

  for chain in $chains; do
    if [ "$table" = "filter" ]; then
      run_rule sudo iptables -t "$table" -D OUTPUT -j "$chain"
      run_rule sudo iptables -t "$table" -D OUTPUT -m owner --uid-owner root -j "$chain"
      run_rule sudo iptables -t "$table" -D OUTPUT -m owner --uid-owner ehecoatl -j "$chain"
    else
      run_rule sudo iptables -t "$table" -D OUTPUT -j "$chain"
    fi
    run_rule sudo iptables -t "$table" -F "$chain"
    run_rule sudo iptables -t "$table" -X "$chain"
  done
}

cleanup_output_matches() {
  local table="$1"
  local pattern="$2"
  local rules rule

  rules="$(sudo iptables -t "$table" -S OUTPUT 2>/dev/null | awk -v pattern="$pattern" 'index($0, pattern) > 0 { print substr($0, 9) }')"

  if [ -z "$rules" ]; then
    return 0
  fi

  while IFS= read -r rule; do
    [ -n "$rule" ] || continue
    run_rule bash -lc "sudo iptables -t '$table' -D OUTPUT $rule"
  done <<< "$rules"
}

log "Releasing every Ehecoatl proxy rule"

cleanup_output_matches "filter" "EHECOATL_PROXY_FILTER_"
cleanup_output_matches "nat" "EHECOATL_PROXY_NAT_"
cleanup_table_chains "filter" "EHECOATL_PROXY_FILTER_"
cleanup_table_chains "nat" "EHECOATL_PROXY_NAT_"

log "All proxy rules removed successfully."
