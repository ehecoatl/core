#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$SCRIPT_DIR/../shared/config.sh" app "$@"
