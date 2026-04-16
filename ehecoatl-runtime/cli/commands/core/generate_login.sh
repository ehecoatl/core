#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../../lib/cli-common.sh"
cli_init "$0"

INTERNAL_USER="$(policy_value 'system.sharedUser')"
INTERNAL_GROUP="$(policy_value 'system.sharedGroup')"

USERNAME="${1:-}"
[ -n "$USERNAME" ] || {
  echo "Usage: ehecoatl core generate login <username> [--password <password>] --scope <selector>..."
  exit 1
}
shift || true

PASSWORD=""
declare -a SCOPE_SELECTORS=()
declare -a RESOLVED_GROUPS=()

if [[ ! "$USERNAME" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "Invalid username '$USERNAME'. Use lowercase letters, digits, underscores, or dashes."
  exit 1
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --password)
      PASSWORD="${2:-}"
      [ -n "$PASSWORD" ] || { echo "Missing value for --password"; exit 1; }
      shift 2
      ;;
    --scope)
      [ -n "${2:-}" ] || { echo "Missing value for --scope"; exit 1; }
      SCOPE_SELECTORS+=("$2")
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

[ "${#SCOPE_SELECTORS[@]}" -gt 0 ] || {
  echo "At least one --scope selector is required."
  exit 1
}

resolve_scope_group() {
  local selector="$1"
  local tenant_json app_json tenant_id app_id

  case "$selector" in
    super)
      printf 'g_superScope'
      return 0
      ;;
    tenant:@????????????)
      tenant_id="${selector#tenant:@}"
      printf 'g_tenantScope_%s' "$tenant_id"
      return 0
      ;;
    tenant:@*)
      tenant_json="$(node "$TENANT_LAYOUT_CLI" find-tenant-json-by-domain "$TENANTS_BASE" "${selector#tenant:@}")"
      [ -n "$tenant_json" ] && [ "$tenant_json" != "null" ] || {
        echo "Tenant selector '$selector' not found." >&2
        return 1
      }
      tenant_id="$(json_field "$tenant_json" tenantId)"
      printf 'g_tenantScope_%s' "$tenant_id"
      return 0
      ;;
  esac

  if [[ "$selector" =~ ^app:([a-z0-9]{12})@([a-z0-9]{12})$ ]]; then
    app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-tenant-id-and-app-id "$TENANTS_BASE" "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}")"
  elif [[ "$selector" =~ ^app:([a-z0-9._-]+)@([a-z0-9]{12})$ ]]; then
    app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-tenant-id-and-app-name "$TENANTS_BASE" "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}")"
  elif [[ "$selector" =~ ^app:([a-z0-9._-]+)@([a-z0-9.-]+)$ ]]; then
    app_json="$(node "$TENANT_LAYOUT_CLI" find-app-json-by-domain-and-app-name "$TENANTS_BASE" "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}")"
  fi

  [ -n "${app_json:-}" ] && [ "$app_json" != "null" ] || {
    echo "App selector '$selector' not found." >&2
    return 1
  }

  tenant_id="$(json_field "$app_json" tenantId)"
  app_id="$(json_field "$app_json" appId)"
  printf 'g_app_%s_%s' "$tenant_id" "$app_id"
}

append_unique_group() {
  local group_name="$1"
  local existing
  for existing in "${RESOLVED_GROUPS[@]}"; do
    [ "$existing" = "$group_name" ] && return 0
  done
  RESOLVED_GROUPS+=("$group_name")
}

for selector in "${SCOPE_SELECTORS[@]}"; do
  append_unique_group "$(resolve_scope_group "$selector")"
done

PRIMARY_GROUP="${RESOLVED_GROUPS[0]}"
SUPPLEMENTARY_GROUPS=""
if [ "${#RESOLVED_GROUPS[@]}" -gt 1 ]; then
  SUPPLEMENTARY_GROUPS="$(IFS=,; printf '%s' "${RESOLVED_GROUPS[*]:1}")"
fi

for group_name in "${RESOLVED_GROUPS[@]}"; do
  getent group "$group_name" >/dev/null 2>&1 || {
    echo "Required scope group '$group_name' does not exist yet."
    exit 1
  }
done

if id "$USERNAME" >/dev/null 2>&1; then
  echo "User '$USERNAME' already exists."
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || { echo "sudo is required."; exit 1; }
  SUDO="sudo"
fi

$SUDO mkdir -p "$MANAGED_LOGINS_DIR"

USERADD_ARGS=(useradd --create-home --home-dir "/home/$USERNAME" --shell /bin/bash --gid "$PRIMARY_GROUP")
[ -n "$SUPPLEMENTARY_GROUPS" ] && USERADD_ARGS+=(--groups "$SUPPLEMENTARY_GROUPS")

$SUDO "${USERADD_ARGS[@]}" "$USERNAME"

if [ -n "$PASSWORD" ]; then
  printf '%s:%s\n' "$USERNAME" "$PASSWORD" | $SUDO chpasswd
else
  $SUDO passwd -l "$USERNAME" >/dev/null
fi

$SUDO node -e '
  const fs = require(`node:fs`);
  const path = require(`node:path`);
  const [dirPath, username, primaryGroup, groupsCsv, selectorsCsv] = process.argv.slice(1);
  const filePath = path.join(dirPath, `${username}.json`);
  const payload = {
    username,
    home: `/home/${username}`,
    shell: `/bin/bash`,
    primaryGroup,
    supplementaryGroups: groupsCsv ? groupsCsv.split(`,`).filter(Boolean) : [],
    scopeSelectors: selectorsCsv ? selectorsCsv.split(`\n`).filter(Boolean) : [],
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + `\n`, `utf8`);
' "$MANAGED_LOGINS_DIR" "$USERNAME" "$PRIMARY_GROUP" "$SUPPLEMENTARY_GROUPS" "$(printf '%s\n' "${SCOPE_SELECTORS[@]}")"
$SUDO chown "$INTERNAL_USER:$INTERNAL_GROUP" "$MANAGED_LOGINS_DIR/$USERNAME.json"
$SUDO chmod 0640 "$MANAGED_LOGINS_DIR/$USERNAME.json"

echo "Managed login '$USERNAME' created."
echo "Home: /home/$USERNAME"
echo "Primary group: $PRIMARY_GROUP"
[ -n "$SUPPLEMENTARY_GROUPS" ] && echo "Supplementary groups: $SUPPLEMENTARY_GROUPS"
[ -n "$PASSWORD" ] || echo "Password state: locked"
