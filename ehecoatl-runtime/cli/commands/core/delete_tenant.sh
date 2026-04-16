#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl core delete tenant @<domain>|@<tenant_id>

Deletes one managed tenant.

Arguments:
  @<domain>       Delete by tenant domain.
  @<tenant_id>    Delete by tenant id.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/delete.sh" tenant "$@"
