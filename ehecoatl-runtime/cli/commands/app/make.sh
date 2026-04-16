#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage:
  ehecoatl app make middleware <new_resource_name>
  ehecoatl app make plugin <new_resource_name>
  ehecoatl app make action <new_resource_name>

Creates a new app-scoped resource in the current app scope.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/make.sh" app "$@"
