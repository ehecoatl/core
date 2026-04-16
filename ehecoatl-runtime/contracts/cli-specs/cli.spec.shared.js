// ehecoatl-runtime/contracts/cli-specs/cli.spec.shared.js


'use strict';


const { group } = require(`../context.js`);

module.exports = {
  ABOUT: {
    label: `Shared CLI command definitions`,
    description: `Reusable command definitions shared by tenant and app scopes for environment inspection and config mutation`,
    contractClass: `SERVICE.CLI.SPEC`
  },
  prefix: null,
  groupsAllowed: [
    `root`,
    group.tenantScope,
    group.appScope
  ],
  COMMANDS: [
    {
      command: `status`,
      old_command: null,
      PARAMS: [],
      ABOUT: {
        label: `Inspect environment status`,
        description: `Returns status details for the current environment selected by the working directory`
      }
    },
    {
      command: `log`,
      old_command: null,
      PARAMS: [],
      ABOUT: {
        label: `Inspect environment logs`,
        description: `Returns log output for the current environment selected by the working directory`
      }
    },
    {
      command: `config`,
      old_command: null,
      PARAMS: [
        {
          prefix: [`--get`],
          optional: true,
          default: null,
          description: `configuration key to read from the selected target`,
          shapes: [`{key}`]
        },
        {
          prefix: [`--set`],
          optional: true,
          default: null,
          description: `configuration key to assign on the selected target`,
          shapes: [`{key}`]
        },
        {
          prefix: null,
          optional: true,
          default: null,
          description: `configuration value used with --set`,
          shapes: [`"{value}"`]
        }
      ],
      ABOUT: {
        label: `Get or set target configuration`,
        description: `Reads a configuration key with --get or updates a configuration key and value with --set`
      }
    }
  ]
};
