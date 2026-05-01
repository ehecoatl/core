#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

SSHD_MANAGED_LOGINS_CONFIG="/etc/ssh/sshd_config.d/90-ehecoatl-managed-logins.conf"

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

refresh_managed_login_sshd_config() {
  command -v sshd >/dev/null 2>&1 || return 0

  local temp_file
  temp_file="$(mktemp)"
  node - "$MANAGED_LOGINS_DIR" > "$temp_file" <<'EOF'
const fs = require(`node:fs`);
const path = require(`node:path`);

const registryDir = process.argv[2];
const usernames = [];
let entries = [];

try {
  entries = fs.readdirSync(registryDir, { withFileTypes: true });
} catch {
}

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(`.json`)) continue;

  try {
    const payload = JSON.parse(fs.readFileSync(path.join(registryDir, entry.name), `utf8`));
    const username = String(payload?.username ?? ``).trim();
    if (payload?.passwordAuthentication === true && /^[a-z_][a-z0-9_-]*$/.test(username)) {
      usernames.push(username);
    }
  } catch {
  }
}

usernames.sort((left, right) => left.localeCompare(right));

process.stdout.write(`# Managed by Ehecoatl. Allows password auth only for managed logins created with --password.\n`);
if (usernames.length > 0) {
  process.stdout.write(`Match User ${usernames.join(`,`)}\n`);
  process.stdout.write(`  PubkeyAuthentication yes\n`);
  process.stdout.write(`  PasswordAuthentication yes\n`);
  process.stdout.write(`  KbdInteractiveAuthentication no\n`);
}
EOF

  $SUDO install -o root -g root -m 0644 "$temp_file" "$SSHD_MANAGED_LOGINS_CONFIG"
  rm -f "$temp_file"
  $SUDO sshd -t
  $SUDO systemctl reload ssh >/dev/null 2>&1 || $SUDO systemctl reload sshd >/dev/null 2>&1 || true
}

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
refresh_managed_login_sshd_config
echo "Managed login '$USERNAME' deleted."
