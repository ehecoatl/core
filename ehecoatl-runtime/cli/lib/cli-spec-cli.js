'use strict';

require(`../../utils/register-module-aliases`);

const contracts = require(`../../contracts/index.js`);

const [command, ...args] = process.argv.slice(2);

function main() {
  switch (command) {
    case `after-cli`:
      return outputJson(getAfterCliCommands(args));
    default:
      throw new Error(`Unknown cli-spec-cli command: ${command ?? `(missing)`}`);
  }
}

function getAfterCliCommands([scope, commandLabel, varsJson = `{}`]) {
  const variables = JSON.parse(varsJson || `{}`);
  const specs = contracts.CLI?.SPECS ?? [];
  const spec = specs.find((entry) => entry?.prefix === scope) ?? null;
  if (!spec) return [];

  const contract = (spec.COMMANDS ?? []).find((entry) => entry?.command === commandLabel) ?? null;
  const commands = contract?.AFTER_CLI?.COMMANDS ?? [];
  return commands.map((item) => renderTemplate(item, variables));
}

function renderTemplate(template, variables = {}) {
  return String(template ?? ``).replace(/\{([^}]+)\}/g, (_, key) => {
    const value = variables?.[key];
    if (value === undefined || value === null || String(value).trim() === ``) {
      throw new Error(`Missing value for AFTER_CLI variable "${key}"`);
    }
    return String(value).trim();
  });
}

function outputJson(value) {
  process.stdout.write(JSON.stringify(value ?? null));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exit(1);
}
