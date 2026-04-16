#!/bin/bash
set -euo pipefail

SERVICE_NAME="ehecoatl.service"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ehecoatl core restart

Restarts the Ehecoatl systemd service.

Options:
  -h, --help   Show this help message.
EOF
    exit 0
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || { echo "sudo is required."; exit 1; }
  SUDO="sudo"
fi

exec $SUDO systemctl restart "$SERVICE_NAME"
