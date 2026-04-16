#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl tenant status

Prints status details for the current tenant scope.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/status.sh" tenant "$@"
