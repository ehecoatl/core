#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl app log

Shows tail output for log files under the current app scope.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/log.sh" app "$@"
