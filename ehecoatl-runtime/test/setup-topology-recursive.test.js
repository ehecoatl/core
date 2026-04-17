'use strict';

require(`module-alias/register`);

const test = require(`node:test`);
const assert = require(`node:assert/strict`);
const fs = require(`node:fs`);
const path = require(`node:path`);

test(`setup materializer applies recursive owner/mode changes when recursive flag is true`, () => {
  const source = fs.readFileSync(
    path.join(__dirname, `..`, `..`, `setup`, `install.sh`),
    `utf8`
  );

  assert.ok(source.includes(`apply_owner_group_mode_recursive()`));
  assert.ok(source.includes(`if [ "$recursive_flag" = "1" ] && [ -d "$target_path" ]; then`));
  assert.ok(source.includes(`chown -R "$owner_name:$group_name" "$target_path"`));
  assert.ok(source.includes(`chmod -R "$mode_value" "$target_path"`));
  assert.ok(source.includes('apply_owner_group_mode_recursive "$target_path" "$owner_name" "$group_name" "$mode_value" "${recursive_flag:-}"'));
});
