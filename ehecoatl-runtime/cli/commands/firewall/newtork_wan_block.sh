#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
source "$SCRIPT_DIR/_firewall_common.sh"

STATE="${1:-}"
[ "$#" -gt 0 ] && shift || true

usage() {
  echo "Usage: ehecoatl firewall newtork_wan_block <on|off> <username|all> [process-label] [input-chain]"
}

case "$STATE" in
  on)
    USER_NAME="${1:-}"
    PROCESS_LABEL="${2:-unknown}"
    INPUT_CHAIN="${3:-}"
    OUTPUT_CHAIN=""

    [ -n "$USER_NAME" ] || {
      usage
      exit 1
    }

    if [ -z "$INPUT_CHAIN" ]; then
      INPUT_CHAIN="$(firewall_resolve_input_chain "$USER_NAME" "$PROCESS_LABEL")"
    fi
    OUTPUT_CHAIN="$(firewall_resolve_output_chain "$USER_NAME" "$PROCESS_LABEL")"

    firewall_log "Applying WAN TCP fencing for user '$USER_NAME' with chains '$INPUT_CHAIN' and '$OUTPUT_CHAIN'"

    firewall_run_rule iptables -t filter -D INPUT -p tcp -j "$INPUT_CHAIN"
    firewall_run_rule iptables -t filter -D OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" -j "$OUTPUT_CHAIN"
    if firewall_chain_exists filter "$INPUT_CHAIN"; then
      firewall_run_rule iptables -t filter -F "$INPUT_CHAIN"
      firewall_run_rule iptables -t filter -X "$INPUT_CHAIN"
    fi
    if firewall_chain_exists filter "$OUTPUT_CHAIN"; then
      firewall_run_rule iptables -t filter -F "$OUTPUT_CHAIN"
      firewall_run_rule iptables -t filter -X "$OUTPUT_CHAIN"
    fi

    if firewall_chain_exists filter "$INPUT_CHAIN"; then
      firewall_run_root iptables -t filter -F "$INPUT_CHAIN"
    else
      firewall_run_root iptables -t filter -N "$INPUT_CHAIN"
    fi
    if firewall_chain_exists filter "$OUTPUT_CHAIN"; then
      firewall_run_root iptables -t filter -F "$OUTPUT_CHAIN"
    else
      firewall_run_root iptables -t filter -N "$OUTPUT_CHAIN"
    fi

    PORTS="$(firewall_extract_tcp_ports_for_user "$USER_NAME" || true)"
    if [ -n "${PORTS:-}" ]; then
      while IFS= read -r port; do
        [ -n "$port" ] || continue
        firewall_run_root iptables -t filter -A "$INPUT_CHAIN" -i lo -p tcp --dport "$port" -j RETURN
        firewall_run_root iptables -t filter -A "$INPUT_CHAIN" ! -i lo -p tcp --dport "$port" -j REJECT
      done <<< "$PORTS"
    fi

    firewall_run_root iptables -t filter -A "$INPUT_CHAIN" -j RETURN
    firewall_run_root iptables -t filter -A "$OUTPUT_CHAIN" -d 127.0.0.1/32 -j RETURN
    firewall_run_root iptables -t filter -A "$OUTPUT_CHAIN" -j REJECT
    firewall_run_root iptables -t filter -A INPUT -p tcp -j "$INPUT_CHAIN"
    firewall_run_root iptables -t filter -A OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" -j "$OUTPUT_CHAIN"
    ;;
  off)
    USER_NAME="${1:-}"
    PROCESS_LABEL="${2:-unknown}"
    INPUT_CHAIN="${3:-}"
    OUTPUT_CHAIN=""

    [ -n "$USER_NAME" ] || {
      usage
      exit 1
    }

    if [ "$USER_NAME" = "all" ]; then
      firewall_log "Removing all Ehecoatl WAN TCP fencing"
      firewall_remove_chain_jumps_by_prefix filter INPUT "EHECOATL_FW_INPUT_" "EHECOATL_FW_I_"
      firewall_remove_chain_jumps_by_prefix filter OUTPUT "EHECOATL_FW_OUTPUT_" "EHECOATL_FW_O_"
      firewall_flush_delete_chains_by_prefix filter "EHECOATL_FW_INPUT_" "EHECOATL_FW_I_" "EHECOATL_FW_OUTPUT_" "EHECOATL_FW_O_"
      exit 0
    fi

    if [ -z "$INPUT_CHAIN" ]; then
      INPUT_CHAIN="$(firewall_resolve_input_chain "$USER_NAME" "$PROCESS_LABEL")"
    fi
    OUTPUT_CHAIN="$(firewall_resolve_output_chain "$USER_NAME" "$PROCESS_LABEL")"

    firewall_log "Removing WAN TCP fencing for user '$USER_NAME' with chains '$INPUT_CHAIN' and '$OUTPUT_CHAIN'"

    firewall_run_rule iptables -t filter -D INPUT -p tcp -j "$INPUT_CHAIN"
    firewall_run_rule iptables -t filter -D OUTPUT -p tcp -m owner --uid-owner "$USER_NAME" -j "$OUTPUT_CHAIN"
    if firewall_chain_exists filter "$INPUT_CHAIN"; then
      firewall_run_rule iptables -t filter -F "$INPUT_CHAIN"
      firewall_run_rule iptables -t filter -X "$INPUT_CHAIN"
    fi
    if firewall_chain_exists filter "$OUTPUT_CHAIN"; then
      firewall_run_rule iptables -t filter -F "$OUTPUT_CHAIN"
      firewall_run_rule iptables -t filter -X "$OUTPUT_CHAIN"
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
