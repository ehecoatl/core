#!/bin/bash

policy_init() {
  local script_path="${1:-$0}"
  local script_dir resolved_script
  local runtime_root

  resolved_script="$(readlink -f "$script_path" 2>/dev/null || printf '%s' "$script_path")"
  script_dir="$(cd "$(dirname "$resolved_script")" && pwd)"

  for runtime_root in \
    "$script_dir" \
    "$(cd "$script_dir/.." && pwd)" \
    "$(cd "$script_dir/../.." && pwd)"
  do
    if [ -f "$runtime_root/contracts/derive-runtime-policy.js" ]; then
      POLICY_DERIVER="$runtime_root/contracts/derive-runtime-policy.js"
      POLICY_FILE="$runtime_root/config/runtime-policy.json"
      return 0
    fi
  done

  if [ -n "${POLICY_PROJECT_DIR:-}" ]; then
    if [ -f "$POLICY_PROJECT_DIR/contracts/derive-runtime-policy.js" ]; then
      POLICY_DERIVER="$POLICY_PROJECT_DIR/contracts/derive-runtime-policy.js"
      POLICY_FILE="$POLICY_PROJECT_DIR/config/runtime-policy.json"
      return 0
    fi

    if [ -f "$POLICY_PROJECT_DIR/ehecoatl-runtime/contracts/derive-runtime-policy.js" ]; then
      POLICY_DERIVER="$POLICY_PROJECT_DIR/ehecoatl-runtime/contracts/derive-runtime-policy.js"
      POLICY_FILE="$POLICY_PROJECT_DIR/ehecoatl-runtime/config/runtime-policy.json"
      return 0
    fi
  fi

  printf '[ERROR] derive-runtime-policy.js not found relative to %s\n' "$script_path" >&2
  return 1
}

policy_value() {
  node "$POLICY_DERIVER" value "$1"
}

policy_array_lines() {
  node "$POLICY_DERIVER" array-lines "$1"
}
