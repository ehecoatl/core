#!/bin/bash

policy_init() {
  local script_path="${1:-$0}"
  local script_dir resolved_script

  resolved_script="$(readlink -f "$script_path" 2>/dev/null || printf '%s' "$script_path")"
  script_dir="$(cd "$(dirname "$resolved_script")" && pwd)"

  if [ -f "$script_dir/../app/config/runtime-policy.json" ]; then
    POLICY_PROJECT_DIR="$(cd "$script_dir/.." && pwd)"
  elif [ -f "$script_dir/../../app/config/runtime-policy.json" ]; then
    POLICY_PROJECT_DIR="$(cd "$script_dir/../.." && pwd)"
  else
    printf '[ERROR] runtime-policy.json not found relative to %s\n' "$script_path" >&2
    return 1
  fi

  POLICY_FILE="$POLICY_PROJECT_DIR/app/config/runtime-policy.json"
}

policy_value() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const path = process.argv[2].split(".");
    let value = data;
    for (const key of path) value = value?.[key];
    if (value === undefined || value === null) process.exit(2);
    if (typeof value === "object") process.stdout.write(JSON.stringify(value));
    else process.stdout.write(String(value));
  ' "$POLICY_FILE" "$1"
}

policy_array_lines() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const path = process.argv[2].split(".");
    let value = data;
    for (const key of path) value = value?.[key];
    if (!Array.isArray(value)) process.exit(3);
    process.stdout.write(value.join("\n"));
  ' "$POLICY_FILE" "$1"
}
