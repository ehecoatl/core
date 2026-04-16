#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl core deploy tenant @<domain> [options]

Deploys a tenant from a tenant kit or repository.

Options:
  -t, --tenant-kit <name>   Tenant kit name to copy into the new tenant.
  --repo <url>              Source repository URL to persist in tenant config.
  -h, --help                Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/deploy.sh" tenant "$@"
