#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

print_help() {
  cat <<'EOF'
Usage: ehecoatl core delete login <username> [options]

Deletes one managed login created by Ehecoatl.

Options:
  --purge-home   Remove the user's home directory after deleting the login.
  -h, --help     Show this help message.
EOF
}

USERNAME="${1:-}"
[ -n "$USERNAME" ] || { print_help; exit 1; }
[ "$USERNAME" != "-h" ] && [ "$USERNAME" != "--help" ] || { print_help; exit 0; }
shift || true

PURGE_HOME=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge-home)
      PURGE_HOME=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

REGISTRY_FILE="$MANAGED_LOGINS_DIR/$USERNAME.json"
[ -f "$REGISTRY_FILE" ] || {
  echo "Login '$USERNAME' is not a managed login registered by Ehecoatl."
  exit 1
}

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || { echo "sudo is required."; exit 1; }
  SUDO="sudo"
fi

HOME_DIR="$(node -e '
  const fs = require(`node:fs`);
  const data = JSON.parse(fs.readFileSync(process.argv[1], `utf8`));
  process.stdout.write(String(data?.home ?? `/home/${process.argv[2]}`));
' "$REGISTRY_FILE" "$USERNAME")"

if id "$USERNAME" >/dev/null 2>&1; then
  $SUDO userdel "$USERNAME"
fi

if [ "$PURGE_HOME" -eq 1 ] && [ -d "$HOME_DIR" ]; then
  $SUDO rm -rf "$HOME_DIR"
fi

$SUDO rm -f "$REGISTRY_FILE"
echo "Managed login '$USERNAME' deleted."
