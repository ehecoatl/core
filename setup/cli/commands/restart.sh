#!/bin/bash
set -euo pipefail

SERVICE_NAME="ehecatl.service"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || { echo "sudo is required."; exit 1; }
  SUDO="sudo"
fi

exec $SUDO systemctl restart "$SERVICE_NAME"
