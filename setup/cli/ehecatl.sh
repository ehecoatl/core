#!/bin/bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
COMMAND="${1:-}"
[ -n "$COMMAND" ] || COMMAND="help"
if [ "$#" -gt 0 ]; then
  shift
fi

COMMANDS_DIR="$BASE_DIR/commands"
SETUP_DIR="$(dirname "$BASE_DIR")"
PROJECT_DIR="$(dirname "$SETUP_DIR")"
APP_DIR="$PROJECT_DIR/app"
PACKAGE_JSON="$APP_DIR/package.json"
COMMAND_FILE="$COMMANDS_DIR/${COMMAND}.sh"

list_command_names() {
  if [ -d "$COMMANDS_DIR" ]; then
    find "$COMMANDS_DIR" -maxdepth 1 -type f -name '*.sh' -printf '%f\n' 2>/dev/null | sed 's/\.sh$//' | sort
  else
    echo "(none)"
  fi
}

# 1. Run bundled command file if it exists.
if [ -f "$COMMAND_FILE" ]; then
  exec "$COMMAND_FILE" "$@"
fi

# 2. Fallback to npm run when a matching script exists.
if [ -f "$PACKAGE_JSON" ] && grep -q "\"$COMMAND\":" "$PACKAGE_JSON"; then
  echo "Running npm script: $COMMAND"
  cd "$APP_DIR" || exit 1
  exec sudo npm run "$COMMAND" -- "$@"
fi

# 3. If not found, list available commands.
if [ "$COMMAND" != "help" ]; then
  echo "Command '$COMMAND' not found."
  echo
fi

echo "Available CLI commands:"
list_command_names

echo
echo "Available npm scripts:"
if [ -f "$PACKAGE_JSON" ]; then
  node -e "
    const pkg = require('$PACKAGE_JSON');
    if (pkg.scripts) {
      console.log(Object.keys(pkg.scripts).join(' '));
    }
  "
else
  echo "  (no package.json found)"
fi

echo " "
exit 1
