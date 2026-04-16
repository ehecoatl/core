#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl tenant enable

Enables the current tenant resolved from the working directory.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/enable.sh" tenant "$@"
