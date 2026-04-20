// ehecoatl-runtime/contracts/cli-specs/cli.spec.tenant.js


'use strict';


const { group, tenantRoot, appRoot } = require(`../context.js`);
const sharedSpec = require(`./cli.spec.shared.js`);

const cloneCommand = (commandName, overrides = {}) => ({
  ...sharedSpec.COMMANDS.find((commandContract) => commandContract.command === commandName),
  ...overrides
});

module.exports = {
  ABOUT: {
    label: `Tenant CLI command spec`,
    description: `Tenant-scoped command surface isolated to one tenant for app deployment plus tenant-level config and extensions, with optional explicit @domain target override`,
    contractClass: `SERVICE.CLI.SPEC`
  },
  prefix: `tenant`,
  groupsAllowed: [
    `root`,
    group.tenantScope
  ],
  COMMANDS: [
    {
      command: `deploy app`,
      old_command: null,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `app name to create inside the selected tenant`,
          shapes: [`{app_name}`]
        },
        {
          prefix: [`-a`, `--app-kit`],
          optional: true,
          default: null,
          description: `optional app-kit source to scaffold into the new app environment; the -app-kit suffix is optional`,
          shapes: [`{kit_name}`]
        },
        {
          prefix: [`--repo`],
          optional: true,
          default: null,
          description: `optional repository URL to associate immediately with the new app environment`,
          shapes: [`{repo_url}`]
        }
      ],
      AFTER_CLI: {
        description: `executed after this command, in this case for director registry refresh`,
        COMMANDS: [
          `ehecoatl core rescan tenants`
        ]
      },
      ABOUT: {
        label: `Create and register a new app environment`,
        description: `Creates a new app environment inside the selected tenant using an app-kit and/or repository source; at least one of kit or repo is required`
      }
    },
    {
      command: `delete app`,
      old_command: null,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `app name to remove from the selected tenant`,
          shapes: [`{app_name}`]
        }
      ],
      ABOUT: {
        label: `Delete an app from the selected tenant`,
        description: `Removes a previously deployed app environment from the selected tenant`
      }
    },
    {
      command: `list`,
      old_command: null,
      PARAMS: [],
      ABOUT: {
        label: `List apps in the current tenant`,
        description: `Returns the apps currently registered inside the selected tenant; tenant commands may also be prefixed with @domain after the tenant scope`
      }
    },
    {
      command: `enable`,
      old_command: null,
      PARAMS: [],
      ABOUT: {
        label: `Enable current tenant`,
        description: `Marks the current tenant as enabled`
      }
    },
    {
      command: `disable`,
      old_command: null,
      PARAMS: [],
      ABOUT: {
        label: `Disable current tenant`,
        description: `Marks the current tenant as disabled`
      }
    },
    {
      command: `make`,
      old_command: null,
      PARAMS: [
        {
          prefix: [`middleware`, `plugin`, `action`],
          optional: false,
          default: null,
          description: `resource type to create followed by its name`,
          shapes: [`{new_resource_name}`]
        }
      ],
      ABOUT: {
        label: `Create a new tenant extension resource`,
        description: `Creates a tenant-shared plugin inside the current tenant`
      }
    },
    cloneCommand(`status`, {
      ABOUT: {
        label: `Inspect tenant status`,
        description: `Returns status details for the current tenant resolved from the working directory`
      }
    }),
    cloneCommand(`log`, {
      ABOUT: {
        label: `Inspect tenant logs`,
        description: `Returns log output for the current tenant resolved from the working directory`
      }
    }),
    cloneCommand(`config`, {
      ABOUT: {
        label: `Get or set tenant configuration`,
        description: `Reads or updates keys in the current tenant config.json resolved from the working directory`
      }
    })
  ]
};
