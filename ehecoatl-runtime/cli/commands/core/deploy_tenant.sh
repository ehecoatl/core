#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl core deploy tenant @<domain> -t <tenant_kit>

Deploys a tenant from a tenant kit. Kits may be folders or .zip files.
Top-level app_<name>/ folders inside the tenant kit are auto-deployed as apps.
Missing kits are looked up in built-in kits, custom extension kits, then
https://github.com/ehecoatl/tenant-kit-<name>.git.

Options:
  -t, --tenant-kit <name>   Tenant kit folder or .zip name to copy/extract.
                             The .zip extension is optional.
                             Zip kits must contain files directly at the zip root.
                             Missing kits may be cloned into custom tenant kits
                             from ehecoatl/tenant-kit-<name>.
                             Top-level app_<name>/ folders are reserved for
                             embedded apps and are removed after app deploy.
  -h, --help                Show this help message.
EOF
    exit 0
    ;;
esac
exec "$SCRIPT_DIR/../shared/deploy.sh" tenant "$@"
