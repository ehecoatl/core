#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl tenant make plugin <new_resource_name>

Creates a new tenant-scoped plugin file in the current tenant scope.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/make.sh" tenant "$@"
