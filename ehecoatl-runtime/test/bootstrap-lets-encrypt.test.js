'use strict';

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const { execFileSync } = require(`node:child_process`);
const path = require(`node:path`);

const bootstrapScriptPath = path.resolve(__dirname, `..`, `..`, `setup`, `bootstraps`, `bootstrap-lets-encrypt.sh`);

function runSourcedBootstrap(snippet) {
  return execFileSync(
    `bash`,
    [
      `-lc`,
      `source "${bootstrapScriptPath}"\n${snippet}`
    ],
    {
      encoding: `utf8`
    }
  ).trim();
}

test(`bootstrap-lets-encrypt resolves apt package set with nginx plugin`, () => {
  const output = runSourcedBootstrap(`
require_command() {
  case "$1" in
    apt-get|apt-cache) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_available() {
  case "$1" in
    letsencrypt|python3-certbot-nginx) return 0 ;;
    *) return 1 ;;
  esac
}
resolve_lets_encrypt_package_name
`);

  assert.equal(output, `certbot letsencrypt python3-certbot-nginx`);
});

test(`bootstrap-lets-encrypt resolves dnf package set with nginx plugin fallback`, () => {
  const output = runSourcedBootstrap(`
require_command() {
  case "$1" in
    dnf) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_available() {
  case "$1" in
    certbot-nginx) return 0 ;;
    *) return 1 ;;
  esac
}
resolve_lets_encrypt_package_name
`);

  assert.equal(output, `certbot certbot-nginx`);
});

test(`bootstrap-lets-encrypt treats certbot plus plugin as pre-existing`, () => {
  const output = runSourcedBootstrap(`
require_command() {
  case "$1" in
    apt-get|apt-cache|certbot) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_available() {
  case "$1" in
    python3-certbot-nginx) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_installed() {
  case "$1" in
    certbot|python3-certbot-nginx) return 0 ;;
    *) return 1 ;;
  esac
}
read_existing_metadata_value() {
  case "$1" in
    LETS_ENCRYPT_PACKAGE_NAME) printf '%s\\n' "certbot python3-certbot-nginx" ;;
    LETS_ENCRYPT_MANAGED_BY_INSTALLER) printf '%s\\n' "0" ;;
    *) return 1 ;;
  esac
}
install_lets_encrypt
printf '%s|%s\\n' "$LETS_ENCRYPT_PACKAGE_NAME" "$LETS_ENCRYPT_MANAGED_BY_INSTALLER"
`);

  assert.equal(output, `certbot python3-certbot-nginx|0`);
});

test(`bootstrap-lets-encrypt installs only the missing plugin package and records the full set`, () => {
  const output = runSourcedBootstrap(`
captured_commands=()
require_command() {
  case "$1" in
    apt-get|apt-cache|certbot) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_available() {
  case "$1" in
    python3-certbot-nginx) return 0 ;;
    *) return 1 ;;
  esac
}
package_is_installed() {
  case "$1" in
    certbot) return 0 ;;
    python3-certbot-nginx) return 1 ;;
    *) return 1 ;;
  esac
}
read_existing_metadata_value() { return 1; }
run_quiet() {
  captured_commands+=("$*")
  return 0
}
install_lets_encrypt
printf '%s\\n' "$LETS_ENCRYPT_PACKAGE_NAME|$LETS_ENCRYPT_MANAGED_BY_INSTALLER|\${captured_commands[0]}|\${captured_commands[1]}"
`);

  assert.equal(
    output,
    `certbot python3-certbot-nginx|1|apt-get update -qq|env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-certbot-nginx`
  );
});
